<script>
	import {startConversation, joinExistingConversation} from './jitsi'
	import {onMount} from 'svelte';
	import {db} from './firebase'

	export let name;
	let newConvoName = '';
	const COLLECTION = "Convos";
	let convos = [];
	let jitsiIsLoaded = false;

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
</script>

<main>
	<h1>Hello {name}!</h1>
	<p>So you want to have a conversation?</p>

	{#if jitsiIsLoaded}
		Then why not go ahead and start one:

		<input type="text" bind:value={newConvoName}>
		<button on:click={() => startConversation(newConvoName)}>START</button>

		{#if convos.length > 0}
			<p>Or join one of those already happening:</p>
			{#each convos as convo}
				<p>
					{convo.room} | {convo.participants} | created at <em>{convo.createdDate.toDate()}</em> | <button on:click={() => joinExistingConversation(convo)}>JOIN</button>
				</p>
			{/each}
		{:else}
			<p>Oh. There aren't any existing conversations?</p>
		{/if}
	{:else}
		[Loading Video API... please reload this page if nothing changes in a while.]
	{/if}

	<div id="meet">
	</div>

</main>

<style>
	main {
		text-align: center;
		padding: 1em;
		max-width: 240px;
		margin: 0 auto;
	}

	h1 {
		color: #ff3e00;
		text-transform: uppercase;
		font-size: 4em;
		font-weight: 100;
	}

	@media (min-width: 640px) {
		main {
			max-width: none;
		}
	}
</style>