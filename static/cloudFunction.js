import {db} from "../src/firebase";
import {ROOMS, USERS} from "../src/jitsi";

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