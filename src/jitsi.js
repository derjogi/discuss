import firebase from "firebase/app";
import {db} from './firebase';

// Firestore Collections:
export const ROOMS = "rooms";
export const USERS = "users";

const second = 1000;

let jitsiAPI;
let roomId;
export let userId;

// These 3 methods are the only ones that a user can call to start, join or schedule a conversation:
export function scheduleConversation(roomName, userName, capacity = 99) {
    console.log("Scheduling " + roomName);
    addRoom(roomName, userName, true, capacity);
}

export function createRoom(roomName, userName, capacity = 99) {
    console.log("Initiating " + roomName);
    addRoom(roomName, userName, false, capacity)
        .then(roomRef => {
            console.log(`Room id: ${roomId}, roomRef: ${roomRef.id}`);
            addUser(userName, true)
        })    // the first user/ the user who creates the room should always be an admin
        .then(() => createAndJoinAPI(roomName, userName));
}

export function enterExistingRoom(roomID, userName) {
    roomId = roomID;
    getRoomNameFromId(roomId).then(roomName => {
        console.log(`Joining room ${roomName} with id ${roomId}`);
        createAndJoinAPI(roomName, userName);
        db.collection(`${ROOMS}/${roomId}/${USERS}`).get()
            .then(users => {
                console.log(`Adding user ${userName} to a room with ${users.size} other users`);
                addUser(userName, users.size === 0)
            });
            // Admin if it's the first user, should be extended to use the user who created this room, or possibly a specified user...(?)
    });
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
    jitsiAPI.addListener('videoConferenceLeft', participantLeavingListener(userName));
    // jitsiAPI.addListener('participantLeft', participantLeavingListener())
}


function participantLeavingListener(userName) {
    return () => {
        console.log("videoConferenceLeft fired for user " + userName);
        removeUser();
        jitsiAPI.dispose();
        jitsiAPI = null;
        document.getElementById("meet").innerHTML = "";
    };
}

async function addRoom(roomName, createdBy, persisting = false, capacity = 99) {
    console.log(`Inserting ${roomName} into database`);
    let roomRef = await db.collection(ROOMS).add(
        {
            roomName: roomName,
            persisting: persisting,
            capacity: capacity,
            createdBy: createdBy,
            createdDate: firebase.firestore.FieldValue.serverTimestamp(),
        });
    roomId = roomRef.id;
    console.log(`Set roomId for ${roomName}: ${roomId}`);
    return roomRef;
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
    console.log(`Adding user: ${userName} to roomId ${roomId}`);
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

async function getRoomNameFromId(roomId) {
    return getDocProperty(`${ROOMS}/${roomId}`);
}

async function getDocProperty(docPath) {
    return db.doc(docPath).get().then(doc => doc.data().roomName);
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
                console.log(`${rooms.size} in database, checking expiry...`);
                rooms.forEach(room => {
                    let roomData = room.data();
                    // Object.entries(data).forEach(entry => console.log(`${entry[0]}: ${entry[1]}`));
                    room.ref.collection(USERS).get().then(users => {
                        let now = Date.now() / 1000;
                        let numberDeleted = 0;
                        users.forEach(user => {
                            let userData = user.data();
                            console.log("Type of userData: " + typeof userData);
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
                        if (!roomData.persisting
                            && now - roomData.createdDate.seconds > 10
                            && (users.empty || users.size - numberDeleted <= 0))
                        {
                            // delete the parent room. Yes, that's possible with firestore, it doesn't need to be empty or anything.
                            console.log("Deleting room " + roomData.roomName);
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