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
	let rooms = [];
	let roomName = '';
	let jitsiIsLoaded = false;

	onMount(() => {
		let meetJs = document.createElement('script');
		meetJs.src = 'https://meet.jit.si/external_api.js';
		document.head.append(meetJs);

		meetJs.onload = function () {
			jitsiIsLoaded = true;
		}
	});

	function fetchExistingConvos() {
		// First up, fetch all ongoing conversations:
		// Todo: how to make it load more n more on scroll?
		// Todo 2: how to make it not wait for ages on load if there are many conversations?
		db.collection(ROOMS)
				.onSnapshot(snap => {
					let tempArray = [];
					let isInRoom = false;
					snap.docs.forEach(doc => {
						let data = doc.data();
						// we want to have the id as part of the data instead of on the document
						// because we're throwing away the document reference.
						data["id"] = doc.id;	// = room
						let users = [];
						doc.ref.collection(USERS).onSnapshot(usrs => {
							usrs.docs.forEach(usr => {
								users.push(usr.id);
								if (usr.id === userName) {
									isAdmin = usr.isAdmin;
								}
							});
							removeEmptyRooms();
						});
						data["users"] = users;	// Todo: make sure that once 'users' gets reassigned it's not deleting the users inside data!
						tempArray.push(data);
						if (doc.id === roomName) {
							currentRoom = data;
							isInRoom = true;
						}
						for (let [key, value] of Object.entries(data)) {
							console.log(`${key}: ${value}`);
						}
					});
					console.log("Snapshot updated, found " + tempArray.length + " rooms");
					rooms = tempArray;	// <-- assignment is important to trigger an update in svelte, 'push' won't do!
					hasJoinedConversation = isInRoom;
					removeEmptyRooms();
				});
	}

	fetchExistingConvos();

	function updateName() {
		customName = userName !== initName;
	}

	let nameWidth = 300;
	$: if (userName.length > 0) {
		let invisibleNameElement = document.getElementById("invisibleName");
		nameWidth = invisibleNameElement ? invisibleNameElement.clientWidth : 300;
	}

	let currentRoom = null;
	function updateCapacity(newCapacity) {

	}
	let hasJoinedConversation = false;
	function enterRoom(room, existing = false) {
		hasJoinedConversation = true;	// a snapshot update will be triggered which updates hasJoinedConversation,
		// but we'd want to set it here already just in case the snapshot update takes a long time.
		roomName = room;
		if (existing) {
			enterExistingRoom(room);
		} else {
			createRoom(room);
		}
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

			{#if jitsiIsLoaded}
				{#if rooms.length > 0}
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
							Participants
						</div>
						<div class="col-md-4">
							Actions
						</div>
					</div>
				<br/>
					{#each rooms as room}
						<div class="{room.users.length > room.capacity ? 'convo-full' : ''} row justify-content-center">
							<div class="col-md-4">
								{room.id}
							</div>
							<div class="col-md-4">
								{room.users}
							</div>
							<div class="col-md-4">
								<button class="btn-join" on:click={() => enterRoom(room, true)}>JOIN</button>
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
				<input type="text" bind:value={newRoomName}>
				<button on:click={() => enterRoom(newRoomName)}>START</button>
				<button on:click={() => scheduleConversation(newRoomName)}>Schedule for later</button>
			{:else}
				<br/><br/>
				[Loading Video API... please reload this page if nothing changes in a while.]
			<!-- End jitsiLoaded -->
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
	<div id="meet" class={isAdmin?"height-90":"height-100"}>
		<!-- Empty, will be used to display the video once someone joins a conversation -->
	</div>
	<div id="meeting-options" class="{isAdmin?'':'no-display'} row justify-content-center">
		<button id="btn-room-full" on:click={() => updateCapacity(currentRoom.participants)}>{currentRoom && currentRoom.participants < currentRoom.capacity ? "Mark room as full" : "Allow new users"}</button>
	</div>
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