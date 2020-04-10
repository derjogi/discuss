<script>
	import {onMount} from 'svelte';
	import {db} from './firebase'
	import {fade} from 'svelte/transition';
	// All those imports are needed, but don't show up as used because they're used in the svelte main body:
	import {
		createRoom,
		enterExistingRoom,
		scheduleConversation,
		deleteRoom,
		removeEmptyRooms, updateRoomProps,
		ROOMS, USERS, userId
	} from './jitsi'

	const initName = " ... you?";
	const USERNAME = "userName";

	let userName = "";
	let customName = false;
	let isAdmin = false;
	let roomName = '';		// the room name a user has actually joined
	let newRoomName = '';	// name when 'creating' a room, which the user might not actually join (e.g. scheduled room).
	let rooms = {};
	// {roomId {
	//        roomName: name,
	// 		  keyX:valueX,
	// 	  	  keyY:valueY, ...
	// 	  	  users: [
	// 	  	 	userId {
	// 	  	 		key1:value1,
	// 	  	 		...
	// 	  	 		},
	// 			usery {},
	//			...
	// 	  	 	]
	// 	  	 },
	//  roomId {fields, users[usrX{values}]}
	//  ...
	//  }

	function loadUsernameFromCookie() {
		let cookies = decodeURIComponent(document.cookie);
		// Todo: if we're ever going to use more cookies than one we'll also need to split by ;
		cookies = cookies.split("=");
		if (cookies[0] === USERNAME) {
			userName = cookies[1];
		}
	}
	loadUsernameFromCookie();

	function updateRooms() {
		// First up, fetch all ongoing conversations:
		// Todo: how to make it load more n more on scroll?
		// Todo 2: how to make it not wait for ages on load if there are many conversations?
		db.collection(ROOMS)
				.onSnapshot(snap => {
					console.log("Updating room snapshot");
					rooms = {};
					snap.forEach(doc => {
						let data = doc.data();
						data["id"] = doc.id;
						if (!data[USERS]) {
							data[USERS] = [];	// so that we don't get 'undefined' errors. Users will be populated in the 'users' snapshot further down.
						}
						rooms[doc.id] = data;
						updateUsers(doc);
						// console.log("Snapshot is updating room " + doc.id);
						// for (let [key, value] of Object.entries(data)) {
						// 	console.log(`${key}: ${value}`);
						// }
					});

					console.log("Finished updating room snapshot");
				});
	}
	updateRooms();

	function updateUsers(room) {
		room.ref.collection(USERS).onSnapshot(users => {
			let tempMap = {};
			console.log(`Update user snapshot for room "${room.data().roomName}"`);
			users.forEach(user => {
				let userData = user.data();
				userData["id"] = user.id;
				tempMap[user.id] = userData;
				console.log(`got user ${userData.userName}, comparing with current user's ${userName} id`);
				if (user.id === userId) {
					isAdmin = userData.isAdmin;
					console.log(`${userName} is ${isAdmin?'':'not '}an admin`);
				}
			});
			rooms[room.id][USERS] = tempMap;
			removeEmptyRooms();
			console.log(`End updating user snapshot`);
		});
	}

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
		nameWidth = invisibleNameElement ? invisibleNameElement.clientWidth : 300;
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
		<h1>Hello
			<input type="text" name="titleName" bind:value={userName} placeholder={initName} style="width:{nameWidth}px">
		</h1>
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
				<div class="conversation-header-row row justify-content-center">
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
			<br/>
				{#each Object.values(rooms) as room}
					<div class="{Object.keys(room.users).length >= room.capacity ? 'convo-full' : ''} row justify-content-center">
						<div class="col-md-3 col-4">
							{room.roomName}
						</div>
						<div class="col-md-3 col-4">
							{Object.keys(room.users).map(user => room.users[user].userName).join(", ")} ({Object.keys(room.users).length})
						</div>
						<div class="col-md-1 col-2">
							<button class="btn-join" on:click={() => enterExistingRoom(room.id, userName)}>{Object.keys(room.users).length >= room.capacity ? 'FULL' : 'JOIN'}</button>
						</div>
						<div class="col-md-1 col-2">
							{#if room.persisting && (Object.keys(room.users).length === 0)}
								<i class="fa fa-close btn-remove" on:click={() => deleteRoom(room.id)}></i>
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

			<button disabled={!roomNameIsValid} on:click={() => scheduleConversation(newRoomName, userName)}>Create Room</button>
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

	h1 {
		color: #ff3e00;
		text-transform: uppercase;
		font-size: 4em;
		font-weight: 100;
	}

	input[name=titleName] {
		border: none;
		border-bottom: 2px solid #ff3e00;
		color: #ff3e00;
		font-weight: inherit;	/* to make it same as other font */
		text-transform: uppercase;
	}

	input[name=titleName] {
		padding: 0;
	}

	input[name=roomNameField]:valid {
		border: 2px solid green;
	}

	input[name=roomNameField]:invalid {
		border: 2px solid red;
	}

	.conversation-header-row {
		font-weight: bold;
	}

	.convo-full {
		color: #666666;
	}

	.convo-full .btn-join {
		visibility: hidden;
	}

	.btn-join {
		float:right;
	}

	.btn-remove {
		font-size:32px;
		color:red;
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
		padding: 20px;	/* to make the input a bit wider */
	}

	@media (min-width: 640px) {
		body {
			max-width: none;
		}
	}
</style>