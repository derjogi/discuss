import firebase from "firebase/app";
import {db} from './firebase';
import {Room} from "./room";

// Firestore Collections:
// Main collection, contains rooms and users as subcollection
export const ROOMS = "rooms";
// a subcollection in each individual room containing the users, but NOT their heartbeats!
export const USERS = "users";
export const USER_HEARTBEATS = "user_heartbeats"


const second = 1000;
let capacity = 6;

let jitsiAPI;
let roomId;
export let userId;

// {roomId: {
//        roomName: name,
// 		  keyX:valueX,
// 	  	  keyY:valueY, ...
//        users: not updated here, see separate 'users' map
// 	  	 },
//  roomId {fields, users[usrX{values}]}
//  ...
//  }
export let rooms = {};

// { roomId: [
// 	  	 	userX: {
// 	  	 		key1:value1,
// 	  	 		...
// 	  	 		},
// 			userY: {},
//			...
// 	  	 	]
// }
export let users = {};


// Todo s:
//  * users.roomId
//  * Need those tables:
//   ** Rooms > Users > list of userNames
//   ** Users' > heartbeats
//    --> from JitsiGroup we only listen to changes in Rooms & Rooms>Users
//    --> from Heartbeat we update Users'
//    --> When a user joins or leaves, the user should be added to both,
//    --> A cloudFunction should check Users' (every... minute?) and if it finds one that's expired update Rooms>Users
//        so that only then (and when users join/actively leave) the listener in JitsiGroup will actually fire & update
//  * If a user looses connection temporarily or the db is temporarily not available, and users have an old heartbeat but then resume...
//   ** not a problem if they resume before the cloud function runs
//   **  IS a problem if the cloud function runs and removes that user.
//      --> If the heartbeater can detect that (e.g. a failure), then it should insert the user new into Users' & into Rooms>Users
//  * We need to have 2 user tables, because we need to separate the heartbeat update from the 'users shown in the table'
//      (we don't want that to update too frequently, i.e. for every user who looks on the table every time any user's heartbeat gets refreshed!)
//  * Rooms > Users subcollection vs. Rooms.users[] array: what is better?
//      * Probably subcollection, because that can be updated independently from the rooms!
//  * rooms.users vs. separate rooms & users:
//      aehm... ? //

export function createRoom(roomName, userName, capacity= capacity) {
    console.log("Scheduling " + roomName);
    // Optimally we'd pass a userId instead of userName as createdBy, but we don't have an ID at this stage.
    // Maybe the ID should be created on the client side, not on the server...
    // But once we have some basic user management (with user login) that shouldn't be a problem anyway any more, so don't worry about it for now.
    addRoom(roomName, userName, true, capacity);
}

// Todo: can we join the room before adding it to the database? That would make it a smoother UX.
//  problem is that we'd want to have some kind of random id in it (which we get for free from the db...)
export function enterRoom(roomID, userName) {
    roomId = roomID;
    let roomName = rooms[roomId].roomName
    console.log(`Joining room ${roomName} with id ${roomId}`);
    createAndJoinAPI(roomName, roomId, userName);
    let usersInRoom = Object.values(users).filter(value => value.roomId === roomId).length;
    console.log(`Adding user ${userName} to a room with ${usersInRoom} other users`);
    addUser(userName, usersInRoom === 0);
    // Admin if it's the first user, should be extended to use the user who created this room, or possibly a specified user...(?)
}

// Other methods:
function createAndJoinAPI(roomName, roomId, userName) {
    let roomWithId = roomName + "_" + roomId;
    let options = {
        roomName: roomWithId,
        parentNode:document.querySelector("#meet")
    };
    console.log("Creating jitsi api for room " + roomName);
    // creating this always creates a new conversation.
    jitsiAPI = new JitsiMeetExternalAPI("meet.jit.si", options);
    jitsiAPI.executeCommands({
        displayName: [ `${userName}`]
        // ,
        // toggleAudio: [],     // Toggles audio and video off when starting
        // toggleVideo: []      // Not sure what is best; maybe could also be a (user?) setting.
    });
    jitsiAPI.addListener('videoConferenceLeft', participantLeavingListener(userName));
    // jitsiAPI.addListener('participantLeft', participantLeavingListener())
    history.pushState(null, null, `?roomName=${roomName}&roomId=${roomId}`);
}

function participantLeft() {
    removeUser();
    jitsiAPI.dispose();
    jitsiAPI = null;
    document.getElementById("meet").innerHTML = "";
    history.pushState(null, null, null);
}

// Called when going back in the browser
window.onpopstate = function (event) {
    console.log(`OnPopState fired: ` + JSON.stringify(event.state));
    console.log("Document location: " + document.location);
    console.log("Search: " + document.location.search);
    if (!document.location.search) {
        participantLeft();
    }
}

function participantLeavingListener(userName) {
    return () => {
        console.log("videoConferenceLeft fired for user " + userName);
        participantLeft();
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
    console.log(`Added room ${roomName} (Id: ${roomId})`);
    return roomRef;
}

export function deleteRoom(roomId, roomName) {
    let ok = confirm(`You are about to delete room ${roomName}.\nDo you want to proceed?`);
    if (ok) db.doc(`${ROOMS}/${roomId}`).delete();
}

/**
 * Adds the current user (client) to the room, can never be a different user.
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
        })
        .then(userRef => {
            userId = userRef.id;
            console.log(`Set userId for ${userName}: ${userId}`);
            setInterval(updateHeartbeat, 30 * second);
        })
        .catch(err => console.log(`Failed to insert user ${userName}. Message was: \n ${err}`));
}

/**
 * Remove the current user (or possibly another user) from a room
 * @param userToRemove defaults to current user
 */
function removeUser(userToRemove = userId, roomToRemoveFrom = roomId) {
    console.log("Removing user: " + userToRemove);
    db.doc(`${ROOMS}/${roomToRemoveFrom}/${USERS}/${userToRemove}`)
        .delete()
        .then(() => removeEmptyRooms());    // Todo: should this only be called after checking for #users on the client side?
}

export function updateRoomProps(props) {
    db.doc(`${ROOMS}/${roomId}`)
        .update(props)
        .then(() => removeEmptyRooms());
}

function updateHeartbeat() {
    if (jitsiAPI != null) {
        // Check whether the #participants still match with registered users.
        let numberOfParticipants = jitsiAPI.getNumberOfParticipants();
        console.log(`Number of participants: ${numberOfParticipants}`);

        db.doc(`${USER_HEARTBEATS}/${userId}`).update({
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(() => {
            let user = users[userId];
            if (user) {
                if (user.roomName)
            }
            db.collection(`${USER_HEARTBEATS}`).doc(userId).set({
                lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
            })
        });
    }
}

// Todo: This should get called whenever ... a snapshot is updated? Should it? Or only when the client knows there should be an empty room?
export function removeEmptyRooms() {
    // this is mainly needed to remove those rooms that are empty (if they're not 'persistent').
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
                            if (userData.lastUpdate) {  // this is sometimes null, I suspect because it is accessed as it is being updated?
                                let secondsSinceLastUpdate = now - userData.lastUpdate.seconds;
                                console.log(`Seconds since user ${userData.userName} was last updated: ${secondsSinceLastUpdate}`);
                                if (secondsSinceLastUpdate > 60) {
                                    console.log("Deleting " + userData.userName);
                                    user.ref.delete();
                                    numberDeleted++;
                                }
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

// This function attaches a listener to the collection which will keep the variable updated whenever there's a change in the database.
function updateRooms() {
    // First up, fetch all ongoing conversations:
    db.collection(ROOMS)
        .onSnapshot(snap => {
            console.log("Updating room snapshot");
            rooms = {};
            snap.forEach(doc => {
                rooms[doc.id] = new Room(doc);
            });
            console.log("Finished updating room snapshot");
        });
}
updateRooms();