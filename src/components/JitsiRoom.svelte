<script>
    import {updateRoomProps} from "./jitsi";

    export let currentRoom;

    let isAdmin = false;
    let roomLocked = false;
    function updateCapacity(newCapacity) {
        if (roomLocked) {
            updateRoomProps({capacity: 99});
        } else {
            updateRoomProps({capacity: newCapacity});
        }
        roomLocked = !roomLocked;
    }
</script>

<!-- Can't be inside an if/else because it needs to be rendered already so the element can be found when the video is created. -->
<div id="ongoing-meeting">
    <div id="meet" class={isAdmin?"height-90":"height-100"}>
        <!-- Empty, will be used to display the video once someone joins a conversation -->
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