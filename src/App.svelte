<script>
	import {onMount} from 'svelte';
	import {fade} from 'svelte/transition';
	import {db} from './firebase'
	import firebase from "firebase/app";	// to update timestamps

	const initName = " ... you?";
	const USERNAME = "userName";
	// Firestore Collections:
	const ROOMS = "rooms";
	const USERS = "users";
	const USER_HEARTBEATS = "user_heartbeats"
	const second = 1000;

	let userName = "";
	let customName = false;
	let isAdmin = false;
	let roomName = '';		// the room name a user has actually joined
	let newRoomName = '';	// name when 'creating' a room, which the user might not actually join (e.g. scheduled room).

	let rooms = {}; // contains roomIds -> roomData, each roomData has a 'users' collection with userIds -> userData
	let jitsiAPI;
	let roomId;
	let userId;
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


	function createRoom(roomName, userName, capacity= default_capacity) {
		console.log("Scheduling " + roomName);
		// Optimally we'd pass a userId instead of userName as createdBy, but we don't have an ID at this stage.
		// Maybe the ID should be created on the client side, not on the server...
		// But once we have some basic user management (with user login) that shouldn't be a problem anyway any more, so don't worry about it for now.
		addRoom(roomName, userName, true, capacity);
	}

	// Todo: can we join the room before adding it to the database? That would make it a smoother UX.
	//  problem is that we'd want to have some kind of random id in it (which we get for free from the db...)
	function enterRoom(roomID, userName) {
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

	function participantLeavingListener(userName) {
		return () => {
			console.log("videoConferenceLeft fired for user " + userName);
			participantLeft();
			history.pushState(null, null, null, )
		};
	}

	// Called when going back in the browser
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

	function participantLeft() {
		removeUser();
		detachRoomUpdater = updateRooms();
		jitsiAPI.dispose();
		jitsiAPI = null;
		document.getElementById("meet").innerHTML = "";
		history.pushState(null, null, null);
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

	function updateRoomProps(props) {
		db.doc(`${ROOMS}/${roomId}`).update(props);
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
					let tempRooms = {};
					snap.forEach(doc => {
						let data = doc.data();
						data[USERS] = {};	// Better to have an empty map than undefined
						tempRooms[doc.id] = data;
						tempRooms[doc.id]["updater"] = updateUsers(doc);
					});
					rooms = {...tempRooms};
					console.log(`Finished updating rooms snapshot for rooms: ${JSON.stringify(rooms)}`);
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
			room[USERS] = tempMap;
			console.log(`Updated user snapshot for room "${room.data().roomName}"`);
		});
	}

	function loadUsernameFromCookie() {
		let cookies = decodeURIComponent(document.cookie);
		// Todo: if we're ever going to use more cookies than one we'll also need to split by ;
		cookies = cookies.split("=");
		if (cookies[0] === USERNAME) {
			userName = cookies[1];
		}
	}

	function loadRoomFromUrl() {
		let query = window.location.search;
		let urlSearchParams = new URLSearchParams(query);
		let roomId = urlSearchParams.get('roomId');
		if (roomId) {
			if (!userName) {
				userName = prompt("Please enter your name for this chat");
				if (userName == null) {
					userName = "Anonymous";
				}
			}
			enterRoom(roomId, userName);
		}
	}
	loadUsernameFromCookie();
	loadRoomFromUrl();

	let hasJoinedConversation;
	let currentRoom;
	$: {
		let userInAnyRoom = false;
		let currentRoomOrNull = null;
		Object.values(rooms).forEach(room => {
			let usersData = Object.values(room[USERS]);
			if (usersData.some(userData => {
				console.log(`Checking ${userData.userName}`);
				return userData.id === userId;
			})) {
				console.log(`Found user ${userName} in ${room.roomName}`);
				userInAnyRoom = true;
				currentRoomOrNull = room;
			}
		});
		hasJoinedConversation = userInAnyRoom;
		currentRoom = currentRoomOrNull;
	}

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
	$: roomNameIsValid = RegExp("^[^?&:\"'%#]+$").test(newRoomName);
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

				{#each Object.entries(rooms) as [id, room], i}
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
				   pattern="^[^?&amp;:&quot;'%#]+$">

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