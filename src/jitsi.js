import firebase from "firebase/app";
import {db} from './firebase'
const COLLECTION = "Convos";
const second = 1000;

let jitsiAPI;
let convoRef;

export function startConversation(room) {
    console.log("Initiating " + room);
    createAndJoinAPI(room);
    insertConvoIntoDatabase(room);
}

function createAndJoinAPI(room) {
    let options = {
        roomName:room,
        width:700,
        height:700,
        parentNode:document.querySelector("#meet")
    };
    console.log("Joining jitsi room " + options.roomName);
    // creating this always creates a new conversation.
    jitsiAPI = new JitsiMeetExternalAPI("meet.jit.si", options);
    // jitsiAPI.executeCommand('displayName', name);
}

function insertConvoIntoDatabase(newConvoName) {
    console.log("Inserting into database...");
    db.collection(COLLECTION).add(
        {
            room: newConvoName,
            participants: 1,
            createdDate: firebase.firestore.FieldValue.serverTimestamp(),
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
        })
        .then(ref => {
            convoRef = ref;
            console.log(`Got reference ${convoRef.id}`);
            decrementWhenLeavingConvo();
        })
        .catch(err => console.log("Failed to insert new conversation or to retrieve its reference :-/ Message was: \n" + err));
}

function decrementWhenLeavingConvo() {
    if (jitsiAPI && convoRef) {
        jitsiAPI.addListener('videoConferenceLeft', () => {
            console.log("LeavingListener fired");
            // console.log(this.event);
            incrementParticipants(convoRef, -1);
            jitsiAPI = null;
            convoRef = null;
            document.getElementById("meet").innerHTML = "";
        });
    } else {
        console.log("JitsiAPI or conversation reference isn't set yet");
    }
}

function incrementParticipants(increment) {
    console.log("Updating participants by: " + increment);
    convoRef.update({
        participants: firebase.firestore.FieldValue.increment(increment),
        lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
    });
}

export function joinExistingConversation(convo) {
    convoRef = getConvoRef(convo.id);
    console.log("Existing Convo.id: " + convo.id);
    createAndJoinAPI(convo.room);
    incrementParticipants(1);
    decrementWhenLeavingConvo();
    console.log("Existing convoRef: " + convoRef.id);
}

function getConvoRef(convoId) {
    return db.collection(COLLECTION).doc(convoId);
}

const timeout = 10 * second;
function removeEmptyRooms() {
    // this is mainly needed to remove those calls that are empty.
    // We can't reliably call something when a user exits, because they might
    // close the browser, internet connection might get interrupted, ...

    // First, update the current conversation if one is ongoing:
    console.log("Checking for expired rooms...");
    db.collection(COLLECTION).get()
        .then(convos => {
            if (convos.empty) {
                console.log("Nothing in database");
            } else {
                console.log(`${convos.size} in database, checking expiry...`);
                convos.forEach(convo => {
                    let data = convo.data();
                    Object.entries(data).forEach(entry => console.log(`${entry[0]}: ${entry[1]}`));
                    if (jitsiAPI && convoRef && convo.id === convoRef.id) {
                        // Ongoing conversation, update the participants and timestamp, don't delete this one!
                        let numberOfParticipants = jitsiAPI.getNumberOfParticipants();
                        console.log(`Number of participants: ${numberOfParticipants}`);
                        convo.ref.update({
                            participants: numberOfParticipants,
                            lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
                        });
                    } else {
                        let now = Date.now()/1000;
                        console.log("Last update: " + data.lastUpdate.seconds);
                        console.log("Now: " + now);
                        let secondsSinceLastUpdate = now - data.lastUpdate.seconds;
                        console.log(`Seconds since last update: ${secondsSinceLastUpdate}`);
                        if (secondsSinceLastUpdate > (timeout/1000)*2) {
                            console.log("Deleting " + data.room);
                            convo.ref.delete();
                        }
                    }
                });
            }
        });
}
setInterval(removeEmptyRooms, timeout);