import { writable } from 'svelte/store'

// Manages some commonly used vars, such as username, rooms, ...
export const userName = writable(' ... you?');

