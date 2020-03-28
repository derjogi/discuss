import {firebaseConfig} from "./firebaseConfig";

let app = firebase.initializeApp(firebaseConfig);
window.db = app.firestore();