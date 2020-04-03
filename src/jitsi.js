import firebase from "firebase/app";
import {db} from './firebase';

import x from 'randomstring';

// Firestore Collections:
export const ROOMS = "rooms";
export const USERS = "users";

const second = 1000;

let jitsiAPI;
let roomName;
let userName;

// These 3 methods are the only ones that a user can call to start, join or schedule a conversation:
export function scheduleConversation(room, user, capacity = 99) {
    console.log("Scheduling " + room);
    roomName = room;
    // The scheduling user should be an admin once he joins. Not implemented yet.
    // Security _might_ be an issue, since any other user with the same name could be an admin as well.
    userName = user;
    addRoom(true, capacity);
}

export function createRoom(room, user, capacity = 99) {
    console.log("Initiating " + room);
    roomName = room;
    userName = user;
    addRoom(false, capacity)
        .then(addUser(true))    // the first user/ the user who creates the room should always be an admin
        .then(createAndJoinAPI());
}

export function enterExistingRoom(roomDocument, user) {
    console.log("Joining room " + roomDocument.id);
    roomName = roomDocument.id;
    userName = user;
    createAndJoinAPI();
    db.collection(`${ROOMS}/${roomName}/${USERS}`).get()
        .then(users => addUser(users.size === 0));  // Admin if it's the first user
}

// Other methods:

function createAndJoinAPI(userName) {
    let options = {
        roomName:roomName,
        parentNode:document.querySelector("#meet")
    };
    console.log("Joining jitsi room " + roomName);
    // creating this always creates a new conversation.
    jitsiAPI = new JitsiMeetExternalAPI("meet.jit.si", options);
    jitsiAPI.executeCommands({
        displayName: [ `${userName}`],
        // Todo: experimental
        toggleAudio: [],     // Toggles audio, will (hopefully?) result in 'off' by default
        toggleVideo: []
    });
    jitsiAPI.addListener('videoConferenceLeft', () => {
        console.log("LeavingListener fired");
        removeUser(userName);
        jitsiAPI.dispose();
        jitsiAPI = null;
        document.getElementById("meet").innerHTML = "";
    });
}

async function addRoom(persisting = false, capacity = 99) {
    console.log("Inserting into database...");
    return db.collection(ROOMS).doc(roomName).set(
        {
            persisting: persisting,
            capacity: capacity,
            createdDate: firebase.firestore.FieldValue.serverTimestamp(),
        })
        .catch(err => console.log("Failed to insert new room. Message was: \n" + err));
}

export function deleteRoom(roomName) {
    db.doc(`${ROOMS}/${roomName}`).delete();
}

/**
 * Adds the current user to the room, can never be a different user.
 * @param isAdmin give this user 'admin rights' if true.
 */
function addUser(isAdmin = false) {
    if (!userName) {
        userName = x.generate(12);
        console.log(`Generated random username ${userName}`);
    }
    console.log("Adding user: " + userName);
    db.collection(`${ROOMS}/${roomName}/${USERS}`).doc(`${userName}`).set({
        isAdmin: isAdmin,
        lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
    });
}

/**
 * Remove the current user or another user from this room
 * @param userToRemove defaults to current user
 */
function removeUser(userToRemove = userName) {
    console.log("Removing user: " + userToRemove);
    db.doc(`${ROOMS}/${roomName}/${USERS}/${userToRemove}`).delete();
}

export function updateRoomProps(props) {
    db.doc(`${ROOMS}/${roomName}`)
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
                rooms.docs.forEach(room => {
                    let data = room.data();
                    Object.entries(data).forEach(entry => console.log(`${entry[0]}: ${entry[1]}`));
                    if (!data.persisting) {
                        room.ref.collection(USERS).get().then(users => {
                            let now = Date.now() / 1000;
                            let numberDeleted = 0;
                            users.docs.forEach(user => {
                                let userData = user.data();
                                Object.entries(userData).forEach(entry => console.log(`${entry[0]}: ${entry[1]}`));

                                let secondsSinceLastUpdate = now - userData.lastUpdate.seconds;
                                console.log(`Seconds since user ${user.id} was last updated: ${secondsSinceLastUpdate}`);
                                if (secondsSinceLastUpdate > (timeout / 1000) * 2) {
                                    console.log("Deleting " + user.id);
                                    user.ref.delete();
                                    numberDeleted++;
                                }
                            });
                            if (users.empty || users.size - numberDeleted <= 0) {
                                // delete the parent room. Yes, that's possible with firestore, it doesn't need to be empty or anything.
                                room.ref.delete();
                            }
                        });
                    }
                });
            }
        });
}

function updateHeartbeat() {
    if (jitsiAPI != null) {
        // Check whether the #participants still match with registered users. Todo: remove once verified that this is actually working properly!
        let numberOfParticipants = jitsiAPI.getNumberOfParticipants();
        console.log(`Number of participants: ${numberOfParticipants}`);

        db.collection(`${ROOMS}/${roomName}/${USERS}`).get()
            .then(users => {
                if (users.size === numberOfParticipants) {
                    console.log("All good, got same number of users.");
                } else {
                    console.warn(`Oh. got ${users.size} users, but ${numberOfParticipants} participants :-/`);
                    users.forEach(user => console.log(user.id));
                }
                users.ref.doc(userName).update({
                    lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
    }
}
setInterval(updateHeartbeat, 30 * second);