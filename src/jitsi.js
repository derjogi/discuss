import firebase from "firebase/app";
import {db} from './firebase';

// Firestore Collections:
export const ROOMS = "rooms";
export const USERS = "users";

const second = 1000;

let jitsiAPI;
let roomId;
let userId;

// These 3 methods are the only ones that a user can call to start, join or schedule a conversation:
export function scheduleConversation(room, user, capacity = 99) {
    console.log("Scheduling " + room);
    addRoom(room, true, capacity);
}

export function createRoom(roomName, userName, capacity = 99) {
    console.log("Initiating " + roomName);
    addRoom(roomName, false, capacity)
        .then(addUser(userName, true))    // the first user/ the user who creates the room should always be an admin
        .then(createAndJoinAPI(roomName, userName));
}

export function enterExistingRoom(roomId, userName) {
    let roomName = getRoomNameFromId(roomId);
    console.log("Joining room " + roomName);
    createAndJoinAPI(roomName, userName);
    db.collection(`${ROOMS}/${roomName}/${USERS}`).get()
        .then(users => addUser(userName, users.size === 0));  // Admin if it's the first user
}

// Other methods:

function createAndJoinAPI(roomName, userName) {
    let options = {
        roomName:roomName,
        parentNode:document.querySelector("#meet")
    };
    console.log("Creating jitsi api for room " + roomName);
    // creating this always creates a new conversation.
    jitsiAPI = new JitsiMeetExternalAPI("meet.jit.si", options);
    jitsiAPI.executeCommands({
        displayName: [ `${userName}`],
        toggleAudio: [],     // Toggles audio and video off when starting
        toggleVideo: []
    });
    jitsiAPI.addListener('videoConferenceLeft', () => {
        console.log("videoConferenceLeft fired for user " + userName);
        removeUser();
        jitsiAPI.dispose();
        jitsiAPI = null;
        document.getElementById("meet").innerHTML = "";
    });
}

async function addRoom(roomName, persisting = false, capacity = 99) {
    console.log(`Inserting ${roomName} into database`);
    db.collection(ROOMS).add(
        {
            roomName: roomName,
            persisting: persisting,
            capacity: capacity,
            createdDate: firebase.firestore.FieldValue.serverTimestamp(),
        })
        .then(roomRef => roomId = roomRef.id)
        .catch(err => console.log(`Failed to insert new room ${roomName}. Message was: \n ${err}`));
}

export function deleteRoom(roomId) {
    db.doc(`${ROOMS}/${roomId}`).delete();
}

/**
 * Adds the current user to the room, can never be a different user.
 * @param userName name of the user to add
 * @param isAdmin give this user 'admin rights' if true.
 */
function addUser(userName, isAdmin = false) {
    console.log("Adding user: " + userName);
    db.collection(`${ROOMS}/${roomId}/${USERS}`).add(
        {
            userName: userName,
            isAdmin: isAdmin,
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
        }).then(userRef => {
            userId = userRef.id;
            console.log(`Set userId for ${userName}: ${userId}`);
        }).catch(err => console.log(`Failed to insert user ${userName}. Message was: \n ${err}`));

}

/**
 * Remove the current user or another user from this room
 * @param userToRemove defaults to current user
 */
function removeUser(userToRemove = userId) {
    console.log("Removing user: " + userToRemove);
    db.doc(`${ROOMS}/${roomId}/${USERS}/${userToRemove}`)
        .delete()
        .then(() => removeEmptyRooms());
}

function getRoomNameFromId(roomId) {
    return getDocProperty(`${ROOMS}/${roomId}`);
}

async function getDocProperty(docPath) {
    return await db.doc(docPath).get().then(doc => {
        return doc.data().roomName;
    });
}

export function updateRoomProps(props) {
    db.doc(`${ROOMS}/${roomId}`)
        .update(props)
        .then(() => removeEmptyRooms());
}

// Todo: This should get called whenever ... a snapshot is updated? Should it?
//  what happens if a user gets removed, does that count as updating a snapshot? Probably not...
export function removeEmptyRooms() {
    // this is mainly needed to remove those calls that are empty.
    // We can't reliably call something when a user exits, because they might
    // close the browser, internet connection might get interrupted, ...

    // First, update the current conversation if one is ongoing:
    console.log("Remove expired users and then empty rooms...");
    db.collection(ROOMS).get()
        .then(rooms => {
            if (rooms.empty) {
                console.log("Nothing in database");
            } else {
                // console.log(`${rooms.size} in database, checking expiry...`);
                rooms.forEach(room => {
                    let data = room.data();
                    // Object.entries(data).forEach(entry => console.log(`${entry[0]}: ${entry[1]}`));
                    room.ref.collection(USERS).get().then(users => {
                        let now = Date.now() / 1000;
                        let numberDeleted = 0;
                        users.forEach(user => {
                            let userData = user.data();
                            // console.log("Keys and values for " + userData.userName);
                            // Object.entries(userData).forEach(entry => console.log(`${entry[0]}: ${entry[1]}`));
                            let secondsSinceLastUpdate = now - userData.lastUpdate.seconds;
                            console.log(`Seconds since user ${userData.userName} was last updated: ${secondsSinceLastUpdate}`);
                            if (secondsSinceLastUpdate > 60) {
                                console.log("Deleting " + userData.userName);
                                user.ref.delete();
                                numberDeleted++;
                            }
                        });
                        if (!data.persisting && (users.empty || users.size - numberDeleted <= 0)) {
                            // delete the parent room. Yes, that's possible with firestore, it doesn't need to be empty or anything.
                            room.ref.delete();
                        }
                    });
                });
            }
        });
}

function updateHeartbeat() {
    if (jitsiAPI != null) {
        // Check whether the #participants still match with registered users. Todo: remove once verified that this is actually working properly!
        let numberOfParticipants = jitsiAPI.getNumberOfParticipants();
        console.log(`Number of participants: ${numberOfParticipants}`);

        db.collection(`${ROOMS}/${roomId}/${USERS}`).get()
            .then(users => {    // users = QuerySnapshot, different from DocReference or so
                if (users.size !== numberOfParticipants) {
                    console.warn(`Oh. got ${users.size} users, but ${numberOfParticipants} participants :-/`);
                    users.forEach(user => console.log(user.data().userName));
                }
                users.docs.find(doc => doc.id === userId).ref.update({
                    lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
    }
}
setInterval(updateHeartbeat, 30 * second);