<script>
	/**
	 * A Project to enable the management of various Jitsi video chat rooms so people can have discussions with each other
	 * in a way that's very simple to manage.
	 *
	 *	Note: This has become a humongous App.svelte file.
	 * I had the intention to split out the script parts of the code into a separate js file,
	 * but because I need to have two-way-binding of many variables that has proven to be more complicated than what it's worth for a MVP.
	 * Priority right now is getting everything to work, then I can take care of nice style later.
	 *
	 **/

	// Todo:
	// Bugs:
	//  * There's a bug where people that join directly with the room-id in the link don't always show up in the table, not sure why.
	//
	// Features:
	//  * Make it easier to create separate 'groups' (e.g. different collections (groups) for different organizations or topics)
	//  ** Split up into components (e.g. JitsiGroup)
	//  ** Make it so other websites can easily integrate this, e.g. church website with their own set of groups (and possibly login protected?)
	//  ** Possibly Group navigation on this website
	//  * Better 'admin' management
	//  ... many many more things. Maybe.

	// Done or discarded:
	//  ✅ * Better security: At the moment the permissions on firestore are open, should be changed so that only authenticated users
	//  ✅   (which can also include anonymous users) are able to write to specific groups
	//  ✅ * I think there's either a bug in removeDeadPeople, or firestore has more or less frequently 2-minute-unavailability.
	//  ✅   Every now and then all people get removed, possibly because no-one can reach google and setting the heartbeat fails (so everyone's thought to be dead if someone calls that method)
	//  ✅   --> increase timeout to 5 minutes instead of 2?
	//  ✅ * Need those tables:
	//  ✅ ** Rooms > Users > list of userNames
	//  ✅ ** Users' > heartbeats
	//  ✅  --> from JitsiGroup (not implemented, but that's the actual 'table', should come soon? There's one in the `Sapper` branch!)
	//  ✅	    we only listen to changes in Rooms & Rooms>Users
	//  ✅  --> from Heartbeat we update Users'
	//  ✅  --> When a user joins or leaves, the user should be added to both,
	//  ❌  --> A cloudFunction should check Users' (every... minute?) and if it finds one that's expired update Rooms>Users
	//  ❌      so that only then (and when users join/actively leave) the listener in JitsiGroup will actually fire & update
	//  ❌ |--> not doing with external cloud function because that costs (3 invokations are free per day, but we'd need... many.)
	//  ✅ |    instead, we're calling a cleanup (`removeDeadPeople`) once when the user opens the main page and everything's initializing (and e.g. on refresh). That should hopefully be enough.
	//  ✅ * If a user looses connection temporarily or the db is temporarily not available, and users have an old heartbeat but then resume...
	//  ✅ ** not a problem if they resume before the cloud function runs
	//  ✅ **  IS a problem if the cloud function runs and removes that user.
	//  ✅    --> If the heartbeater can detect that (e.g. a failure), then it should insert the user new into Users' & into Rooms>Users
	//  ✅ * We need to have 2 user tables, because we need to separate the heartbeat update from the 'users shown in the table'
	//  ✅    (we don't want that to update too frequently, i.e. for every user who looks on the table every time any user's heartbeat gets refreshed!)
	//  ✅ * Rooms > Users subcollection vs. Rooms.users[] array: what is better?
	//  ✅    * Probably subcollection, it can actually be updated independently from the rooms.
	//  ✅ * rooms.users vs. separate rooms & users:
	//  ✅    aehm... ? Might be easier to access rooms.users than a separate collection? Possibly?

	import {onMount} from 'svelte';
	import {fade} from 'svelte/transition';	// It is used! (but not recognized because it's used in the html parts?)
	import {db} from './firebase'
	import firebase from "firebase/app";	// to update timestamps
	import "firebase/auth";

	const initName = " ... you?";
	const USERNAME = "userName";
	// Firestore Collections:
	const ROOMS = "rooms";
	const USERS = "users";
	const USER_HEARTBEATS = "user_heartbeats"

	const second = 1000;

	let rooms = {}; // contains roomIds -> roomData, each roomData has a 'users' collection with userIds -> userData that get updated independently

	let userName = "";
	let customName = false;
	let isAdmin = false;
	let newRoomName = '';	// name when 'creating' a room, which the user might not actually join (e.g. scheduled room).
	let jitsiAPI;
	let currentRoom;
	let hasJoinedConversation = false;	// Only needed because for some reason setting currentRoom = null and then checking if(currentRoom) doesn't always work :-/
	let roomId;
	let default_capacity = 6;
	let userId;

	firebase.auth()
			.signInAnonymously()
			.catch(function(error) {
				console.warn(`Tried to sign in, but got ${error.code}: ${error.message}`);
				// Todo: if a sign-in doesn't work, we should retry, right? But how? Or should we do something else?
			});

	firebase.auth().onAuthStateChanged(user => {
		if (user.uid != null) {
			userId = user.uid;
			loadRoomFromUrl();
		}
	})


	function loadUsernameFromCookie() {
		let cookies = decodeURIComponent(document.cookie);
		// Todo: if we're ever going to use more cookies than one we'll also need to split by ; or do some other magic
		cookies = cookies.split("=");
		if (cookies[0] === USERNAME) {
			userName = cookies[1];
		}
	}

	function loadRoomFromUrl() {
		let hash = window.location.hash;
		if (!hash) return;
		let room = hash.substr(1, hash.length);	// to remove the #
		if (room) {
			let roomNameAndId = room.split("_");
			if (roomNameAndId.length !== 2) {
				alert(`The room in this address (${roomNameAndId}) isn't valid. It needs to have exactly one underscore '_'`)
				history.pushState({title:'Home - Discuss'}, null, '/');
				return;
			}
			let elementById = document.getElementById('meet');
			if (!elementById) {
				elementById = document.createElement("div");
				elementById.id = "meet";
				elementById.className = "ongoing-meeting height-100"
				document.body.appendChild(elementById);
			}
			console.log(`loading room from url with roomId ${roomNameAndId[1]}`);
			if (!userName) {
				userName = prompt("Please enter your name for this chat");
				if (userName == null) {
					userName = "Anonymous";
				}
			}
			if (Object.keys(rooms).length > 0) {
				enterRoom(roomNameAndId[1], userName);
			} else {
				// get the roomName from the url:
				enterRoomViaRoomName(roomNameAndId[0], roomNameAndId[1], userName);

			}
		}
	}
	loadUsernameFromCookie();

	function updateName() {
		customName = userName && userName !== initName;
	}
	updateName();

	let nameWidth = 300;
	$: if (userName.length > 0) {
		let invisibleNameElement = document.getElementById("invisibleName");
		nameWidth = invisibleNameElement ? invisibleNameElement.clientWidth + 20 : 300;
		document.cookie = USERNAME + "=" + userName;
	}

	function createRoom(roomName, userName, capacity= default_capacity) {
		console.log("Scheduling " + roomName);
		// Optimally we'd pass a userId instead of userName as createdBy, but we don't have an ID at this stage.
		// Maybe the ID should be created on the client side, not on the server...
		// But once we have some basic user management (with user login) that shouldn't be a problem anyway any more, so don't worry about it for now.
		addRoom(roomName, userName, true, capacity);
	}

	function checkAndCreateRoom(event) {
		if (roomNameIsValid && event.key === 'Enter') {
			createRoom(newRoomName, userName);
		}
	}

	function enterRoom(roomID, userName) {
		let roomName = rooms[roomID].roomName
		enterRoomViaRoomName(roomName, roomID, userName);
		currentRoom = rooms[roomID];
	}

	function enterRoomViaRoomName(roomName, roomID, userName) {
		roomId = roomID;
		console.log(`Joining room ${roomName} with id ${roomId}`);

		// check whether the user is already in any other room:
		let isInAnotherRoom = false;
		Object.values(rooms).forEach(room => isInAnotherRoom |= Object.keys(room[USERS]).some(user => user === userId))
		if (isInAnotherRoom) {
			let enter = window.confirm("You seem to have already joined a conversation, maybe in a different tab. Are you sure you want enter?");
			if (!enter) return;
		}
		createAndJoinAPI(roomName, roomId, userName);
		if (rooms && rooms[roomId]) {
			let usersInRoom = Object.keys(rooms[roomId][USERS]).length;
			console.log(`Adding user ${userName} to a room with ${usersInRoom} other users`);
			isAdmin = usersInRoom === 0;
		} else {
			isAdmin = false;
		}
		hasJoinedConversation = true;
		addUser(userName, isAdmin);
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
		history.pushState({title:roomName}, roomName, `#${roomWithId}`);
		document.title = roomName;
	}

	function participantLeavingListener(userName) {
		return () => {
			console.log("videoConferenceLeft fired for user " + userName);
			participantLeft();
			history.pushState({title:'Home - Discuss'}, null, '/');
			document.title = 'Home - Discuss';
		};
	}

	// Called when going back in the browser
	window.onpopstate = event => {
		console.log(`OnPopState fired: ` + JSON.stringify(event.state));
		console.log("Document location: " + document.location);
		if (event.state && event.state.title) {
			console.log("Setting title " + event.state.title);
			document.title = event.state.title
		}
		if (!document.location.search && hasJoinedConversation) {
			// if the user navigates back to a page that doesn't have any parameters then make sure that user's also leaving the conversation properly.
			participantLeft();
			document.location.hash = '';	/// can't do 'pushState' here, otherwise the user couldn't go forward again?
			document.title = 'Home - Discuss';
			// Todo: optimally if there are other parameters those should be parsed and the user should join another room. Maybe it's doing that already though?
		} else {
			loadRoomFromUrl();
		}
	}

	function participantLeft() {
		removeUser();
		detachRoomUpdater = updateRooms();
		jitsiAPI.dispose();
		jitsiAPI = null;
		document.getElementById("meet").innerHTML = "";
		currentRoom = null;
		hasJoinedConversation = false;
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
		console.log(`Added room ${roomName} (Id: ${roomId})`);
		return roomRef;
	}

	function deleteRoom(roomId, roomName) {
		let ok = confirm(`You are about to delete room ${roomName}.\nDo you want to proceed?`);
		if (ok) {
			console.log("Deleting room " + roomId);
			db.doc(`${ROOMS}/${roomId}`)
					.delete()
					.catch(error => console.log("Couldn't delete, got error " + error));
		}
	}

	/**
	 * Adds the current user (client) to the room
	 * @param userName name of the user to add
	 * @param isAdmin give this user 'admin rights' if true.
	 */
	function addUser(userName, isAdmin = false) {
		console.log(`Adding user: ${userName} to roomId ${roomId}`);
		if (!userId) {
			console.warn(`UserId ${userId} not set, the user isn't authenticated. (Yet?)`);
			alert("Sorry, couldn't identify you. Please try again.");
		}
		db.collection(`${ROOMS}/${roomId}/${USERS}`).doc(userId).set(
				{
					userName: userName,
					isAdmin: isAdmin
				})
				.then(() => {
					db.doc(`${USER_HEARTBEATS}/${userId}`).set({
						lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
					});
					setInterval(updateHeartbeat, 99 * second);
					// We're removing people every 300s (5min), by updating the heartbeat every 100s users should be able to miss up to 2 intervals
					// and still be alive. (Firestore seems to be frequently unavailable for 2 minutes or so)
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

	function updateRoomProps(props) {
		db.doc(`${ROOMS}/${roomId}`).update(props);
	}

	function updateHeartbeat() {
		if (jitsiAPI != null && roomId) {
			// Check whether the #participants still match with registered users.
			let numberOfParticipants = jitsiAPI.getNumberOfParticipants();
			console.log(`Number of participants: ${numberOfParticipants}`);

			db.doc(`${USER_HEARTBEATS}/${userId}`).update({
				roomId: roomId,
				lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
			}).catch(error => {
				console.log(`Oh, got an error setting a user heartbeat for ${userName}: ${error}`);
				// The user might have been deleted due to lost connection but has come back. Re-insert the user into the db.
				let room = rooms[roomId];
				if (room) {	// if the room doesn't even exist any more the user doesn't need to be in it either.
					let user = room[USERS][userId];	// these different ways of writing are confusing. Does room.users[userId] resolve to room.userData ?
					if (!user) {
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
					roomId: roomId,
					lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
				})
			});
		}
	}

	let roomsInitialized = false;
	let usersInitializedCounter = 0;

	function updateRooms() {
		return db.collection(ROOMS)
				.onSnapshot(snap => {
					console.log("Updating room snapshot");
					let tempRooms = {};
					snap.forEach(doc => {
						let data = doc.data();
						data[USERS] = {};	// Better to have an empty map than undefined
						tempRooms[doc.id] = data;
						tempRooms[doc.id]["updater"] = updateUsers(doc);
					});
					rooms = {...tempRooms};
					console.log(`Finished updating rooms snapshot for rooms: ${JSON.stringify(rooms)}`);
					roomsInitialized = true;
				});
	}
	let detachRoomUpdater = updateRooms();
	let detachRoomAndUserUpdaters = () => {
		console.log("Detaching listener");
		Object.values(rooms).forEach(room => room.updater());
		detachRoomUpdater();
	}

	function updateUsers(room) {
		return room.ref.collection(USERS).onSnapshot(users => {
			let tempMap = {};
			users.forEach(user => tempMap[user.id] = user.data());
			rooms[room.id][USERS] = tempMap;
			console.log(`Updated user snapshot for room ${rooms[room.id].roomName}: ${JSON.stringify(tempMap)}`);
			usersInitializedCounter++;
		});
	}

	// If the page gets reloaded for some reason with the room hash in it, we might have to set currentRoom independently
	$: if (!currentRoom && roomId && hasJoinedConversation && roomsInitialized && usersInitializedCounter === Object.keys(rooms).length) {
		currentRoom = rooms[roomId]
	}

	// Removing dead people is done only once when the client loads the page.
	// I can't do scheduled cloud functions (at least not on firebase) without paying,
	// and if this is only once per new user that should be fine. Most users will anyway stay in their conversation,
	// and even if they're looking at the table it will get cleaned whenever someone else refreshes, so should be all fine.
	// Might be a few hundred calls, but better than doing it in an interval.
	let hasRemovedTheDead = false;
	$: if (!hasRemovedTheDead && roomsInitialized && usersInitializedCounter === Object.keys(rooms).length) {
		// And we do this after rooms have been initialized so that we can look users up in the map.
		removeDeadPeople();
		hasRemovedTheDead = true;
	}
	function removeDeadPeople() {
		console.log(`Checking for dead people.`);
		db.collection(USER_HEARTBEATS).get()
				.then(snap => {
					let cutoff = new Date(Date.now() - (5 * 60 * second));
					let dead = true;
					let deadsVsAlives = snap.docs.reduce((deadOrAlive, thatPerson) => {
						let lastUpdate = thatPerson.data().lastUpdate.toDate();
						let isDead = lastUpdate.getTime() < cutoff.getTime();
						if (!deadOrAlive[isDead]) deadOrAlive[isDead] = [];	// create empty array so that push succeeds...
						deadOrAlive[isDead].push(thatPerson.id);
						return deadOrAlive;
					}, {true:[], false:[]});	// specify default so we don't fail if there are none.
					let zombies = deadsVsAlives[dead];
					let alives = deadsVsAlives[!dead];
					console.log(`found ${zombies.length} zombies, and ${alives.length} active chatters.`);

					let thePathOfTheZombies = [];
					Object.entries(rooms).forEach((roomEntry) => {
						let usersInRoom = Object.keys(roomEntry[1][USERS]);
						let theDead = usersInRoom.filter(person => zombies.includes(person) || !alives.includes(person));
						theDead.forEach(zombie => thePathOfTheZombies.push(`${ROOMS}/${roomEntry[0]}/${USERS}/${zombie}`));
					});

					let batch = db.batch();
					thePathOfTheZombies.forEach(path => {
						batch.delete(db.doc(path));
					});
					zombies.forEach(zombie => {
						return batch.delete(db.doc(`${USER_HEARTBEATS}/${zombie}`));
					})

					batch.commit().then(() => console.log("Yeah, we cleansed all rooms off zombies!"));
				});
	}

	function getNestedObject(obj, ...args) {
		return args.reduce((obj, level) => obj && obj[level], obj);
	}

	let roomLocked = false;
	function updateCapacity(newCapacity) {
		if (roomLocked) {
			updateRoomProps({capacity: 99});
		} else {
			updateRoomProps({capacity: newCapacity});
		}
		roomLocked = !roomLocked;
	}

	let roomNameIsValid;
	$: roomNameIsValid = RegExp("^[^?&:\"'%#/]+$").test(newRoomName);

	let sortedRoomEntries;
	$: sortedRoomEntries = Object.entries(rooms).sort((entryA, entryB) => {
		return entryA[1].roomName.localeCompare(entryB[1].roomName);
	});
</script>

<!-- JoinedConversation -->
{#if !hasJoinedConversation}
	<div id="main-option-panel" transition:fade>
		<div id="bannerImage">
			<img src="./images/group-discussion.png" alt="" >
		</div>
		<div id="title">
			<h1>Hello
				<input type="text" name="titleName" bind:value={userName} placeholder={initName} style="width:{nameWidth}px">
			</h1>
		</div>
		<br>
		<h2>Do you want to join a discussion?</h2>

		{#if !customName}
			<div transition:fade>
				<form on:submit|preventDefault={updateName}>
					<label for="name">Let us know your name first:</label>
					<input type="text" id="name" bind:value={userName} placeholder="Enter your Name">
				</form>
			</div>
		{/if}
		{#if userName.length > 0 && userName !== initName}
			{#if Object.keys(rooms).length > 0}
			<br/>
			<br/>
				<h3>You can join one of those:</h3>
			<br/>
			<br/>
			<div class="container">
				<div class="conversation-header-row even row justify-content-center">
					<div class="col-md-3 col-4">
						Room Name
					</div>
					<div class="col-md-3 col-4">
						Participants (#)
					</div>
					<div class="col-md-2 col-4">
						Actions
					</div>
				</div>

				{#each sortedRoomEntries as [id, room], i}
					<div class="{Object.keys(room.users).length >= room.capacity ? 'convo-full' : ''} {i % 2 === 0 ? 'odd' : 'even'} row justify-content-center">
						<div class="col-md-3 col-4">
							{room.roomName}
						</div>
						<div class="col-md-3 col-4">
							{Object.keys(room.users).map(user => room.users[user].userName).join(", ")} ({Object.keys(room.users).length})
						</div>
						<div class="col-md-1 col-2">
							<button class="btn-join" on:click={() => enterRoom(id, userName)}>{Object.keys(room.users).length >= room.capacity ? 'FULL' : 'JOIN'}</button>
						</div>
						<div class="col-md-1 col-2">
							{#if room.persisting && (Object.keys(room.users).length === 0)}
								<i class="fa fa-close btn-remove" on:click={() => deleteRoom(id, room.roomName)}></i>
							{/if}
						</div>
					</div>
				{/each}
			</div>
			<br/><br/>
				<h3>Or start a new one: </h3>
			{:else}
			<br/>
				<h3>Oh. There aren't any existing conversations?</h3>
				<br/>
				<h3>Then why not go ahead and start one! </h3>

			<!--  End convos -->
			{/if}
			<br/><br/>
			<input type="text" name=roomNameField
				   bind:value={newRoomName}
				   required
				   pattern="^[^?&amp;:&quot;'%#]+$"
				   on:keydown={checkAndCreateRoom}>

			<button disabled={!roomNameIsValid} on:click={() => createRoom(newRoomName, userName)}>Create Room</button>
			{#if newRoomName.length > 1 && !roomNameIsValid}
			<br/>
				<span class="validation-hint">
				INVALID - The room name can't contain any of these characters: ?, &amp;, :, ', &quot;, %, #
				</span>
			{/if}
		<!-- End customName -->
		{/if}
		<!-- This should stay at the bottom of the page, it's not visible but still takes space / pushes other elements down. -->
		<br/>
		<div id="invisibleName">
			<h1>{userName?userName:initName}</h1>
		</div>
	</div>
<!-- End !JoinedConversation -->
{/if}

<!-- Can't be inside an if/else because it needs to be rendered already so the element can be found when the video is created. -->
<div id="ongoing-meeting">
	<div id="meet" class={isAdmin?"height-90":hasJoinedConversation?"height-100":""}>
		<!-- Empty, will be used to display the video once someone joins a conversation -->
	</div>
	{#if currentRoom}
		<div id="meeting-options" class="{isAdmin?'':'no-display'} row justify-content-center">
			<button id="btn-room-full" on:click={() => updateCapacity(Object.keys(currentRoom.users).length)}>
				{currentRoom && Object.keys(currentRoom.users).length < currentRoom.capacity
				? "Mark room as full" : "Allow new users"}
			</button>
		</div>
	{/if}
</div>


<style>
	#main-option-panel {
		text-align: center;
		padding: 1em;
		margin: 0 auto;
		color: #333;
		box-sizing: border-box;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
	}

	#bannerImage {
		float: right;
		width: 100%;
	}

	#bannerImage img {
		width: 60%;
		max-width: 700px;
		margin-top: -18px;
	}

	#title h1 {
		font-weight: 800;
	}

	h1 {
		color: #5996cd;
		text-transform: uppercase;
		font-size: 4em;
		font-weight: 100;
	}

	h2 {
		font-weight: 100;
	}

	input[name=titleName] {
		border: none;
		border-bottom: 2px solid #1e7cd0;
		color: #5996cd;
		font-weight: inherit;	/* to make it same as other font */
		text-transform: uppercase;
		background: #ffffff00;
		padding: 0;
	}

	input[name=roomNameField]:valid {
		border: 2px solid #5996cd;
	}

	input[name=roomNameField]:invalid {
		border: 2px solid #5996cd;
	}

	.conversation-header-row {
		font-weight: bold;
		padding-bottom: 6px;
	}

	.row.even {
		background-color: #edf5ff;
	}

	.row.odd {
		background-color: #b8deff;
	}

	.convo-full {
		color: #666666;
	}

	.convo-full .btn-join {
		visibility: hidden;
	}

	.btn-join {
		float:right;
		background-color: grey;
		color: white;
	}

	.btn-remove {
		font-size:32px;
		color: grey;
		float:left;
	}

	.no-display {
		display: none;
	}

	.is-hidden {
		visibility: hidden;
	}

	#meet {
		padding: 0;
	}

	#meeting-options {
		padding: 10px;
	}

	.height-90 {
		height: 90vh;
	}

	.height-100 {
		height: 100vh;
	}

	#invisibleName {
		visibility: hidden;
		display: inline-block;
		font-weight: 900;
		text-transform: uppercase;
		white-space: pre;
	}

	#invisibleName h1{
		font-weight: 900;
		margin: 20px;
	}

	@media (min-width: 320px) {
		body {
			max-width: none;
		}
	}
</style>