import firebase from "firebase/app";
import 'firebase/auth';
import 'firebase/firestore'
import {firebaseConfig} from './firebaseConfig';

export let userId;

firebase.initializeApp(firebaseConfig);

firebase.auth()
    .signInAnonymously()
    .catch(function(error) {
        console.warn(`Tried to sign in, but got ${error.code}: ${error.message}`);
        // Todo: if a sign-in doesn't work, we should retry, right? But how? Or should we do something else?
    });

firebase.auth().onAuthStateChanged(user => {
    if (user.uid != null) {
        userId = user.uid;
    }
})

export const db = firebase.firestore();