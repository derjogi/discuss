<script>
	import {onMount} from 'svelte';
	import {db} from './firebase'
	import { fade } from 'svelte/transition';
	// All those imports are needed, but don't show up as used because they're used in the svelte main body:
	import {startConversation, joinExistingConversation, scheduleConversation, deletePersistency, convoRef} from './jitsi'

	const initName = "er... you?";
	let name = "";
	let customName = false;
	let newConvoName = '';
	const COLLECTION = "Convos";
	let convos = [];
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
		db.collection(COLLECTION)
			.onSnapshot(data => {
				let tempArray = [];
				data.docs.forEach(doc => {
					let data = doc.data();
					// we want to have the id as part of the data instead of on the document
					// because we're throwing away the document reference.
					data["id"] = doc.id;
					tempArray.push(data)
				});
				console.log("Snapshot updated, found " + tempArray.length + " ongoing Conversations");
			convos = tempArray;	// <-- assignment is important to trigger an update, 'push' won't do!
				convos.forEach(convo => {
					for (let [key, value] of Object.entries(convo)) {
						console.log(`${key}: ${value}`);
					}
				});
			});
	}
	fetchExistingConvos();

	function deleteConvo(convo) {
		deletePersistency(convo);
	}

	function joinConversation(convo, existing = false) {
		if (existing) {
			joinExistingConversation(convo);
		} else {
			startConversation(convo);
		}
		hasJoinedconversation = true;
	}

	function updateName() {
		customName = name !== initName;
	}

	let nameWidth = 300;
	$: if(name.length > 0) {
		console.log("ksaf;afjn");
		let invisibleNameElement = document.getElementById("invisibleName");
		console.log(`Invisible name element: ${invisibleNameElement}`);
		nameWidth = invisibleNameElement ? invisibleNameElement.clientWidth : 300;
		console.log("NameWidth: " + nameWidth);
	}

	let hasJoinedconversation = false;
	$: if (hasJoinedconversation) {
		console.log(`JoinedConversation: ${hasJoinedconversation}; ConvoRef: ${convoRef}`);
		hasJoinedconversation = convoRef;
	}

</script>

<!-- JoinedConversation -->
{#if !hasJoinedconversation}
	<div id="main-option-panel" transition:fade>
		<h1>Hello
			<input type="text" name="titleName" bind:value={name} placeholder={initName} style="width:{nameWidth}px">
		</h1>
		<br>
		<h2>So you want to have a conversation?</h2>

	{#if !customName}
		<div transition:fade>
			<form on:submit|preventDefault={updateName}>
				<label for="name">Let us know your name first:</label>
				<input type="text" id="name" bind:value={name} placeholder="Enter your Name">
			</form>
		</div>
	{/if}

	{#if customName}
		{#if jitsiIsLoaded}
			{#if convos.length > 0}
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
				{#each convos as convo}
					<div class="{convo.participants > 8 ? 'convo-full' : ''} row justify-content-center">
						<div class="col-md-4">
							{convo.room}
						</div>
						<div class="col-md-4">
							{convo.participants}
						</div>
						<div class="col-md-4">
							<button class="btn-join" on:click={() => joinConversation(convo, true)}>JOIN</button>
							{#if convo.persisting }
								<button class="btn-persist" on:click={() => deleteConvo(convo)}>Delete Conversation</button>
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
			<input type="text" bind:value={newConvoName}>
			<button on:click={() => joinConversation(newConvoName, false)}>START</button>
			<button on:click={() => scheduleConversation(newConvoName)}>Schedule for later</button>
		{:else}
			<br/><br/>
			[Loading Video API... please reload this page if nothing changes in a while.]
		<!-- End jitsiLoaded -->
		{/if}

		<!-- This should stay at the bottom of the page, it's not visible but still takes space / pushes other elements down. -->
		<br/>
		<div id="invisibleName">
			<h1>{name?name:initName}</h1>
		</div>
		<!-- End customName	-->
	{/if}
	</div>
<!-- End JoinedConversation -->
{/if}

	<div id="meet">
		<!-- Empty, will be used to display the video once someone joins a conversation -->
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

	input[type=text] {
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

	.convo-full>.btn-join {
		visibility: hidden;
	}

	#meet {
		padding: 0;
		height: 100%;
	}

	#invisibleName {
		visibility: hidden;
		display: inline-block;
	}

	@media (min-width: 640px) {
		body {
			max-width: none;
		}
	}
</style>