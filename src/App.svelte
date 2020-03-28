<script>
	import {onMount} from 'svelte';
	import {db} from './firebase'
	import { fade } from 'svelte/transition';
	// All those imports are needed, but don't show up as used because they're used in the svelte main body:
	import {startConversation, joinExistingConversation, scheduleConversation, deletePersistency} from './jitsi'

	export let name;
	let newConvoName = '';
	const COLLECTION = "Convos";
	let convos = [];
	let jitsiIsLoaded = false;
	let hasJoinedconversation = false;

	onMount(() => {
		let script = document.createElement('script');
		script.src = 'https://meet.jit.si/external_api.js';
		document.head.append(script);

		script.onload = function () {
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
</script>

{#if !hasJoinedconversation}
	<div id="main-option-panel" transition:fade>
		<h1>Hello {name}!</h1>
		<p>So you want to have a conversation?</p>

		{#if jitsiIsLoaded}
			{#if convos.length > 0}
				<p>Then why don't you join one of those:</p>
				{#each convos as convo}
					<p>
						{convo.room} | {convo.participants} | <button on:click={() => joinConversation(convo, true)}>JOIN</button>
						{#if convo.persisting }
							<button on:click={() => deleteConvo(convo)}>Delete Conversation</button>
						{/if}
					</p>
				{/each}
				<p>Or start a new one: </p>
			{:else}
				<p>Oh. There aren't any existing conversations?</p>
				<p>Then why not go ahead and start one! </p>
			{/if}
			<input type="text" bind:value={newConvoName}>
			<button on:click={() => joinConversation(newConvoName, false)}>START</button>
			<button on:click={() => scheduleConversation(newConvoName)}>Schedule for later</button>
		{:else}
			[Loading Video API... please reload this page if nothing changes in a while.]
		{/if}
	</div>
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

	#meet {
		padding: -8px;
		height: 100%;
	}

	@media (min-width: 640px) {
		body {
			max-width: none;
		}
	}
</style>