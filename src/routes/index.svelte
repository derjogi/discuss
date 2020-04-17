<script>
	import {fade} from 'svelte/transition';
	import {stores} from '@sapper/app';
	import Header from "../components/Header.svelte";
	import JitsiGroup from "../components/JitsiGroup.svelte";
	import {loadUsernameFromCookie} from "../jitsi";

	const {preloading, page, session} = stores();

	export let userName = "";
	const initName = " ... you?";
	const USERNAME = "userName";

	userName = loadUsernameFromCookie();

	// If a user enters a direct link to a room the user should go there directly:
	function loadRoomFromUrl() {
		let roomId = page.params.roomId;
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
	loadRoomFromUrl();

	// if customName is set the input field asking for a name will disappear
	let customName = false;
	function updateName() {
		customName = userName && userName !== initName;
	}
	updateName();

	// To dynamically adjust the size of the name input field in the header we need to write it in an invisible element and get that length:
	let nameWidth = 300;
	$: if (userName.length > 0) {
		let invisibleNameElement = document.getElementById("invisibleName");
		nameWidth = invisibleNameElement ? invisibleNameElement.clientWidth + 20 : 300;
		document.cookie = USERNAME + "=" + userName;
	}
</script>

<!-- Optimally we'd have this in a separate <Header> component. But it's not trivial because we're setting the userName in it and there's some cross-action going on with other  -->
<div id="bannerImage">
	<img src="./images/group-discussion.png" alt="" >
</div>
<div id="title">
	<h1>Hello
		<input type="text" name="titleName" bind:value={userName} placeholder={initName} style="width:{nameWidth}px">
	</h1>
</div>

<div id="main-option-panel">
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
		<JitsiGroup userName={userName}/>
	{/if}

		<!-- This should stay at the bottom of the page, it's not visible but still takes space / pushes other elements down. -->
	<br/>
	<div id="invisibleName">
		<h1>{userName?userName:initName}</h1>
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