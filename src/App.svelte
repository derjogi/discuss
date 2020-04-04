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
		ROOMS, USERS
	} from './jitsi'

	const initName = " ... you?";
	let userName = "";
	let customName = false;
	let isAdmin = false;
	let newRoomName = '';	// 'roomName' is reserved for the one room a user has joined in, so we need a different var for only 'creating' a room.
	let rooms = {};
	// {roomX {
	// 		  key1:value1,
	// 	  	  key2:value2, ...
	// 	  	  users: [
	// 	  	 	userx {
	// 	  	 		key1:value1,
	// 	  	 		...
	// 	  	 		},
	// 			usery {},
	//			...
	// 	  	 	]
	// 	  	 },
	//  roomY {fields, users[usrX{values}]}
	//  ...
	//  }
	let roomName = '';
	let jitsiIsLoaded = false;
	const USERNAME = "userName";

	function loadUsernameFromCookie() {
		let cookies = decodeURIComponent(document.cookie);
		// Todo: if we're ever going to use more cookies than one we'll also need to split by ;
		cookies = cookies.split("=");
		if (cookies[0] === USERNAME) {
			userName = cookies[1];
		}
	}

	onMount(() => {
		let meetJs = document.createElement('script');
		meetJs.src = 'https://meet.jit.si/external_api.js';
		document.head.append(meetJs);

		meetJs.onload = function () {
			jitsiIsLoaded = true;
		};

		loadUsernameFromCookie();
	});

	function updateRooms() {
		// First up, fetch all ongoing conversations:
		// Todo: how to make it load more n more on scroll?
		// Todo 2: how to make it not wait for ages on load if there are many conversations?
		db.collection(ROOMS)
				.onSnapshot(snap => {
					rooms = {};
					snap.forEach(doc => {
						let data = doc.data();
						data["id"] = doc.id;	// the room is keyed under oomName already, but we're not storing that in currentRoom, so assign it as a value as well
						if (!data["users"]) {
							data["users"] = [];	// so that we don't get 'undefined' errors. Users will be populated in the 'users' snapshot further down.
						}
						rooms[doc.id] = data;
						updateUsers(doc);
						// console.log("Snapshot is updating room " + doc.id);
						// for (let [key, value] of Object.entries(data)) {
						// 	console.log(`${key}: ${value}`);
						// }
					});

					console.log("Rooms at end of snapshot:");
					console.log(`${Object.keys(rooms)}`);

					// removeEmptyRooms();	// Todo: I don't think we need this here; we should update stuff when _users_ change instead, right?
				});
	}

	updateRooms();

	function updateUsers(room) {
		room.ref.collection(USERS).onSnapshot(snap => {
			let tempMap = {};
			let isInRoom = false;
			console.log(`Update user snapshot for ${room.id}`);
			snap.forEach(doc => {
				tempMap[doc.id] = doc.data();
				console.log(`got user ${doc.id}, comparing with current user ${userName}`);
				if (doc.id === userName) {
					isAdmin = doc.data().isAdmin;
					console.log(`${userName} is ${isAdmin?'':'not'} an admin`);
					isInRoom = true;
				}
			});
			rooms[room.id]["users"] = tempMap;	// Todo: does this trigger UI update? Should since it is an assignment...
			hasJoinedConversation = isInRoom;
			console.log(`hasJoinedConversation: ${hasJoinedConversation}`);
			removeEmptyRooms();
		});
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

	let hasJoinedConversation = false;
	function enterRoom(room, existing = false) {
		hasJoinedConversation = true;	// a snapshot update will be triggered which updates hasJoinedConversation,
		// but we'd want to set it here already just in case the snapshot update takes a long time.
		roomName = room;
		if (existing) {
			enterExistingRoom(room, userName);
		} else {
			createRoom(room, userName);
		}
	}


	let roomNameIsValid;
	$: {
		roomNameIsValid = RegExp("^[^?&:\"'%#]+$").test(newRoomName);
		console.log("Valid: " + roomNameIsValid);
	}


</script>


<!-- JoinedConversation -->
{#if !hasJoinedConversation}
	<div id="main-option-panel" transition:fade>
		<h1>Hello
			<input type="text" name="titleName" bind:value={userName} placeholder={initName} style="width:{nameWidth}px">
		</h1>
		<br>
		<h2>So you want to have a conversation?</h2>

		{#if !customName}
			<div transition:fade>
				<form on:submit|preventDefault={updateName}>
					<label for="name">Let us know your name first:</label>
					<input type="text" id="name" bind:value={userName} placeholder="Enter your Name">
				</form>
			</div>
		{/if}
		{#if userName.length > 0 && userName !== initName}
			{#if jitsiIsLoaded}
				{#if Object.keys(rooms).length > 0}
				<br/>
				<br/>
					<h3>Then why don't you join one of those:</h3>
				<br/>
				<br/>
				<div class="container">
					<div class="row justify-content-center">
						<div class="col-md-4">
							Room Name
						</div>
						<div class="col-md-4">
							Participants (max)
						</div>
						<div class="col-md-4">
							Actions
						</div>
					</div>
				<br/>
					{#each Object.values(rooms) as room}
						<div class="{Object.keys(room.users).length >= room.capacity ? 'convo-full' : ''} row justify-content-center">
							<div class="col-md-4">
								{room.id}
							</div>
							<div class="col-md-4">
								{Object.keys(room.users).join(", ")} ({room.capacity})
							</div>
							<div class="col-md-4">
								<button class="btn-join" on:click={() => enterRoom(room.id, true)}>{Object.keys(room.users).length >= room.capacity ? 'FULL' : 'JOIN'}</button>
								{#if room.persisting }
									<button class="btn-persist" on:click={() => deleteRoom(room.id)}>Delete Conversation</button>
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

				<button on:click={() => enterRoom(newRoomName)}>START</button>
				<button on:click={() => scheduleConversation(newRoomName)}>Schedule for later</button>
				{#if newRoomName.length > 1 && !roomNameIsValid}
				<br/>
					<span class="validation-hint">
					INVALID - The room name can't contain any of these characters: ?, &amp;, :, ', &quot;, %, #
				 	</span>
				{/if}
			{:else}
				<br/><br/>
				[Loading Video API... please reload this page if nothing changes in a while.]
			<!-- End jitsiLoaded -->
			{/if}
		<!-- End customName -->
		{/if}
		<!-- This should stay at the bottom of the page, it's not visible but still takes space / pushes other elements down. -->
		<br/>
		<div id="invisibleName">
			<h1>{userName?userName:initName}</h1>
		</div>
	</div>
<!-- End JoinedConversation -->

{/if}
<!-- Can't be inside an if/else because it needs to be rendered already so the element can be found when the video is created. -->
<div id="ongoing-meeting">
	<div id="meet" class={isAdmin?"height-90":hasJoinedConversation?"height-100":""}>
		<!-- Empty, will be used to display the video once someone joins a conversation -->
	</div>
	{#if rooms[roomName]}
		<div id="meeting-options" class="{isAdmin?'':'no-display'} row justify-content-center">
			<button id="btn-room-full" on:click={() => updateCapacity(Object.keys(rooms[roomName].users).length)}>
				{rooms[roomName] && Object.keys(rooms[roomName].users).length < rooms[roomName].capacity
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

	.convo-full {
		color: #666666;
	}

	.convo-full .btn-join {
		visibility: hidden;
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