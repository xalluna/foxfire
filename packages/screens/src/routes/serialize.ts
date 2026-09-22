import { parseSearchWith, stringifySearchWith } from '@tanstack/react-router'

/*
 * Search params as plain text rather than JSON.
 *
 * The router's default serialiser JSON-encodes values, so a period reads
 * `?range=%2230d%22` and a Riot ID comes back wrapped in quotes. Every value a
 * Foxfire URL carries is a word or a number, and these are links people read
 * and paste — so values go into the URL as they are, and each route's
 * validateSearch turns the text back into what its page takes.
 *
 * Numbers still arrive as numbers: the router's query decoder does that before
 * any parser runs, which is why the validators accept either.
 */

export const parseSearch = parseSearchWith((value) => value)

// Only ever reached for a value that is an object, which no Foxfire route
// holds; JSON is the router's own choice for those, kept rather than dropped.
export const stringifySearch = stringifySearchWith((value) => JSON.stringify(value))
