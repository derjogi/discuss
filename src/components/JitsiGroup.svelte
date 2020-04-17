<script context="module">
export async function preload(page, session) {
}
</script>

<script>
    import {createRoom, deleteRoom, updateRooms} from "../jitsi";

    export let userName;    // Passed in from parent component
    export let rooms;

    let newRoomName = "";
    let roomNameIsValid;
    $: roomNameIsValid = RegExp("^[^?&:\"'%#]+$").test(newRoomName);

</script>

what's in a room?
{#each Object.keys(rooms) as room}
    A room: {room}
{/each}

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
        {#each Object.values(rooms) as room, i}
            <div class="{Object.keys(room.users).length >= room.capacity ? 'convo-full' : ''} {i % 2 === 0 ? 'odd' : 'even'} row justify-content-center">
                <div class="col-md-3 col-4">
                    {room.roomName}
                </div>
                <div class="col-md-3 col-4">
                    {Object.keys(room.users).map(user => room.users[user].userName).join(", ")} ({Object.keys(room.users).length})
                </div>
                <div class="col-md-1 col-2">
                    <a href="room/{room.id}" class="btn btn-join">{Object.keys(room.users).length >= room.capacity ? 'FULL' : 'JOIN'}</a>
                </div>
                <div class="col-md-1 col-2">
                    {#if room.persisting && (Object.keys(room.users).length === 0)}
                        <i class="fa fa-close btn-remove" on:click={() => deleteRoom(room.id, room.roomName)}></i>
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