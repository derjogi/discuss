<script>
    import {updateRoomProps, userName} from "../../jitsi";
    import {onMount} from 'svelte'

    const { preloading, page, session } = stores();
    export let roomId = page.params.roomId;
    export let currentRoom;


    // Once the divs below are 'mounted' (= registered with the DOM) we can call the enterRoom method, which will put the video frame inside the #meet div.
    onMount(() => {
        enterRoom(roomId, userName);
    })

    let isAdmin = false;
    let roomLocked = false;
    function updateCapacity(newCapacity) {
        roomLocked = !roomLocked;
        if (roomLocked) {
            updateRoomProps({capacity: newCapacity});
        } else {
            updateRoomProps({capacity: 99});
        }
    }
</script>

<div id="ongoing-meeting">
    <div id="meet" class={isAdmin?"height-90":"height-100"}>
        <!-- Empty, will be used to display the video once someone joins a conversation, which happens when the JitsiAPI is created -->
    </div>
    <div id="meeting-options" class="{isAdmin?'':'no-display'} row justify-content-center">
        <button id="btn-room-full" on:click={() => updateCapacity(Object.keys(currentRoom.users).length)}>
            {currentRoom && Object.keys(currentRoom.users).length < currentRoom.capacity
            ? "Mark room as full" : "Allow new users"}
        </button>
    </div>
</div>
<style>

</style>