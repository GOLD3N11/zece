/*
 * Conturi și sincronizare (Firebase).
 * Cât timp valoarea de mai jos e `null`, aplicația funcționează ca înainte: datele rămân doar în browser.
 * Pentru a porni conturile, înlocuiește `null` cu obiectul „firebaseConfig” din consola Firebase
 * (Project settings → Your apps → Web app). Aceste chei sunt publice prin natura lor; protecția datelor
 * vine din regulile Firestore (vezi firestore.rules), care lasă fiecare utilizator să-și vadă doar propriile date.
 */
window.ZECE_FIREBASE = null;
/* Exemplu:
window.ZECE_FIREBASE = {
    apiKey: "AIza…",
    authDomain: "zece-xxxx.firebaseapp.com",
    projectId: "zece-xxxx",
    storageBucket: "zece-xxxx.appspot.com",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abcdef"
};
*/
