import firebase from "firebase/app";
import {db} from './firebase';

// Firestore Collections:
export const ROOMS = "rooms";
export const USERS = "users";
const USER_HEARTBEATS = "user_heartbeats"

const second = 1000;

export let rooms; // contains roomIds -> roomData, each roomData has a 'users' collection with userIds -> userData
let jitsiAPI;
let roomId;
export let userId;
let default_capacity = 6;

// Todo s:
//  ✅ * Need those tables:
//  ✅ ** Rooms > Users > list of userNames
//  ✅ ** Users' > heartbeats
//    --> from JitsiGroup we only listen to changes in Rooms & Rooms>Users
//  ✅  --> from Heartbeat we update Users'
//  ✅  --> When a user joins or leaves, the user should be added to both,
//    --> A cloudFunction should check Users' (every... minute?) and if it finds one that's expired update Rooms>Users
//        so that only then (and when users join/actively leave) the listener in JitsiGroup will actually fire & update
//  ✅* If a user looses connection temporarily or the db is temporarily not available, and users have an old heartbeat but then resume...
//  ✅ ** not a problem if they resume before the cloud function runs
//  ✅ **  IS a problem if the cloud function runs and removes that user.
//  ✅    --> If the heartbeater can detect that (e.g. a failure), then it should insert the user new into Users' & into Rooms>Users
//  ✅ * We need to have 2 user tables, because we need to separate the heartbeat update from the 'users shown in the table'
//  ✅    (we don't want that to update too frequently, i.e. for every user who looks on the table every time any user's heartbeat gets refreshed!)
//  ✅ * Rooms > Users subcollection vs. Rooms.users[] array: what is better?
//  ✅    * Probably subcollection, it can actually be updated independently from the rooms.
//  ✅ * rooms.users vs. separate rooms & users:
//  ✅    aehm... ? Might be easier to access rooms.users than a separate collection? Possibly?


export function createRoom(roomName, userName, capacity= default_capacity) {
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
    let usersInRoom = Object.values(rooms[roomId]).length;
    console.log(`Adding user ${userName} to a room with ${usersInRoom} other users`);
    addUser(userName, usersInRoom === 0);
    // Admin if it's the first user, should be extended to use the user who created this room, or possibly a specified user...(?)
    if (detachRoomUpdater) {
        detachRoomAndUserUpdaters();  // this detaches the listener; we don't need it while we're actually in the room. (Only needed for the table)
        detachRoomUpdater = null;
    }
}

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
    detachRoomUpdater = updateRooms();
}

// // Called when going back in the browser
window.onpopstate = function (event) {
    console.log(`OnPopState fired: ` + JSON.stringify(event.state));
    console.log("Document location: " + document.location);
    console.log("Search: " + document.location.search);
    if (!document.location.search) {
        // if the user navigates back to a page that doesn't have any parameters then make sure that user's also leaving the conversation properly.
        participantLeft();
        // Todo: optimally if there are other parameters those should be parsed and the user should join another room. Maybe it's doing that already though?
    }
}

function participantLeavingListener(userName) {
    return () => {
        console.log("videoConferenceLeft fired for user " + userName);
        participantLeft();
        goto('index.svelte');   // Todo: check this is correct.
    };
}

async function addRoom(roomName, createdBy, persisting = false, capacity = default_capacity) {
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
 * Adds the current user (client) to the room
 * @param userName name of the user to add
 * @param isAdmin give this user 'admin rights' if true.
 */
function addUser(userName, isAdmin = false) {
    console.log(`Adding user: ${userName} to roomId ${roomId}`);
    db.collection(`${ROOMS}/${roomId}/${USERS}`).add(
        {
            userName: userName,
            isAdmin: isAdmin
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
 * @param roomToRemoveFrom defaults to current room
 */
function removeUser(userToRemove = userId, roomToRemoveFrom = roomId) {
    console.log("Removing user: " + userToRemove);
    db.doc(`${ROOMS}/${roomToRemoveFrom}/${USERS}/${userToRemove}`)
        .delete()/*
        .then(() => {
        // Only necessary if we're actually having rooms that need to be removed when they're empty.
        // But at the moment we only have 'scheduled' rooms, i.e. every room is persistent.
        // Also, this room-cleaning might be done better from a cloud function in regular intervals, rather than from each client.
            let users = rooms[roomToRemoveFrom].users;
            let userIds = Object.keys(users);
            if ((userIds.length === 1 && userIds[userToRemove]) || userIds.length === 0) {
                removeEmptyRooms();
            }
        })*/;
}

export function updateRoomProps(props) {
    db.doc(`${ROOMS}/${roomId}`)
        .update(props);
}

export function loadUsernameFromCookie() {
    let cookies = decodeURIComponent(document.cookie);
    // Todo: if we're ever going to use more cookies than one we'll also need to split by ; or do something else more intelligent
    cookies = cookies.split("=");
    if (cookies[0] === USERNAME) {
        return cookies[1];
    }
}

function updateHeartbeat() {
    if (jitsiAPI != null) {
        // Check whether the #participants still match with registered users.
        let numberOfParticipants = jitsiAPI.getNumberOfParticipants();
        console.log(`Number of participants: ${numberOfParticipants}`);

        db.doc(`${USER_HEARTBEATS}/${userId}`).update({
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(() => {
            // The user might have been deleted due to lost connection but has come back. Re-insert the user into the db.
            let room = rooms[roomId];
            if (room) {
                let user = room.users[userId];
                if (!user) {
                    // ah damn. we don't have the username here, and I don't know how to / am too lazy to pass it in.
                    // grab it from the cookie, it must have been set when the name was last changed. (Can't get it from the dom element because we're likely not on the index any more)
                    let userName = loadUsernameFromCookie();
                    if (!userName) {
                        userName = "Guest";
                    }
                    db.doc(`${ROOMS}/${roomId}/${USERS}/${userId}`).set({
                        userName: userName,
                        isAdmin: false  // you blink you loose. Todo.
                    })
                }
            }
            db.doc(`${USER_HEARTBEATS}/${userId}`).set({
                lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
            })
        });
    }
}

function updateRooms() {
    return db.collection(ROOMS)
        .onSnapshot(snap => {
            console.log("Updating room snapshot");
            rooms = {};
            snap.forEach(doc => {
                let data = doc.data();
                data[USERS] = [];	// Better to have an empty collection than undefined
                rooms[doc.id] = data;
                rooms[doc.id]["updater"] = updateUsers(doc);
            });
            console.log("Finished updating room snapshot");
        });
}
let detachRoomUpdater = updateRooms();
let detachRoomAndUserUpdaters = () => {
    Object.values(rooms).forEach(room => room.updater());
    detachRoomUpdater();
}

function updateUsers(room) {
    return room.ref.collection(USERS).onSnapshot(users => {
        let tempMap = {};
        console.log(`Update user snapshot for room "${room.data().roomName}"`);
        users.forEach(user => tempMap[user.id] = user.data());
        rooms[room.id][USERS] = tempMap;
        console.log(`End updating user snapshot`);
    });
}

