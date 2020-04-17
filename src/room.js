import {USERS} from "./jitsi";

export class Room {
    roomId;
    data;
    users = {};

    constructor(roomRef) {
        this.roomId = roomRef.id;
        this.data = roomRef.data();

        // Have the listener here just to make it clearer that this only updates the users in this room
        // and that when there's a new room created (or one is updated) it creates it's new own listener.
        roomRef.collection(USERS).onSnapshot(users => {
            console.log(`Update user snapshot for room "${this.data.roomName}"`);
            this.users = {};    // Clear it so that users that aren't there any more get actually removed.
            users.forEach(user => {
                this.users[user.id] = user.data();
            });
            console.log(`End updating user snapshot`);
        });
    }

    get data() {
        return this.data;
    }

    set users(users) {
        this.users = users;
    }

    addUser(userId, data) {
        this.users[userId] = data;
    }

    get users() {
        return this.users;
    }

    get userSize() {
        return Object.keys(this.users).length;
    }
}