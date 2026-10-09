/*
 * Zece ↔ Firebase: conturi (Google, email + parolă) și o copie a datelor în cloud.
 * Aplicația (script.js) nu vorbește direct cu Firebase, ci doar cu obiectul `window.ZeceCloud` de mai jos:
 *   onUser(cb) · signInGoogle() · signInEmail(email, parolă) · signUpEmail(email, parolă, nume)
 *   resetPassword(email) · signOut() · load() · save(json, device, updatedAt) · watch(cb) · deleteAccount()
 * Datele unui utilizator stau într-un singur document: users/{uid} = { backup: „backup-ul” JSON, updatedAt, device }.
 * Fără configurare (firebase-config.js), modulul anunță doar că nu există cloud și aplicația rămâne locală.
 */
const SDK = "https://www.gstatic.com/firebasejs/10.14.1";

async function start(config) {
    const [{ initializeApp }, A, F] = await Promise.all([
        import(`${SDK}/firebase-app.js`),
        import(`${SDK}/firebase-auth.js`),
        import(`${SDK}/firebase-firestore.js`)
    ]);
    const app = initializeApp(config);
    const auth = A.getAuth(app);
    auth.languageCode = "ro"; // emailurile (resetare parolă) și fereastra Google, în română
    await A.setPersistence(auth, A.browserLocalPersistence);
    const db = F.getFirestore(app);
    const ref = () => F.doc(db, "users", auth.currentUser.uid);

    const toUser = u => u && {
        uid: u.uid,
        email: u.email || "",
        name: u.displayName || "",
        photo: u.photoURL || "",
        providers: u.providerData.map(p => p.providerId)
    };
    const toRemote = snap => {
        if (!snap.exists()) return null;
        const d = snap.data();
        return { json: String(d.backup || ""), updatedAt: Number(d.updatedAt) || 0, device: String(d.device || "") };
    };

    // Revenire după autentificarea prin redirecționare (când fereastra Google a fost blocată).
    A.getRedirectResult(auth).catch(err => console.warn("Autentificare Google prin redirecționare:", err.code));

    return {
        onUser: cb => A.onAuthStateChanged(auth, u => cb(toUser(u))),
        async signInGoogle() {
            const provider = new A.GoogleAuthProvider();
            provider.setCustomParameters({ prompt: "select_account" });
            try {
                await A.signInWithPopup(auth, provider);
            } catch (err) {
                if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment") {
                    await A.signInWithRedirect(auth, provider);
                    return;
                }
                throw err;
            }
        },
        signInEmail: (email, password) => A.signInWithEmailAndPassword(auth, email, password),
        async signUpEmail(email, password, name) {
            const cred = await A.createUserWithEmailAndPassword(auth, email, password);
            if (name) await A.updateProfile(cred.user, { displayName: name });
        },
        resetPassword: email => A.sendPasswordResetEmail(auth, email),
        signOut: () => A.signOut(auth),
        load: async () => toRemote(await F.getDoc(ref())),
        save: (json, device, updatedAt) => F.setDoc(ref(), { backup: json, device, updatedAt, savedAt: F.serverTimestamp(), v: 1 }),
        // Doar schimbările confirmate de server (nu și ecoul propriilor scrieri, încă în curs).
        watch: cb => F.onSnapshot(ref(), snap => { if (!snap.metadata.hasPendingWrites) cb(toRemote(snap)); }, err => console.warn("Sincronizare:", err.code)),
        async deleteAccount() {
            await F.deleteDoc(ref());
            await A.deleteUser(auth.currentUser);
        }
    };
}

const config = window.ZECE_FIREBASE;
const ready = config && config.apiKey ? start(config) : Promise.resolve(null);
ready
    .catch(err => {
        console.error("Conturile nu au putut porni (Firebase):", err);
        return null;
    })
    .then(api => {
        window.ZeceCloud = api;
        window.dispatchEvent(new CustomEvent("zece-cloud", { detail: api }));
    });
