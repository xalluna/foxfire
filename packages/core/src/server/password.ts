/**
 * How long a password has to be, in the one place that says so.
 *
 * The server decides — Identity refuses anything shorter, and would refuse it
 * again however this file changed. What lives here is the same rule said early,
 * where somebody is still typing, so that a form can answer without a round
 * trip and without inventing a second number.
 *
 * Length and nothing else, which is the server's rule too: no character
 * classes, because they push people towards Passw0rd! and a passphrase beats it
 * comfortably.
 */
export const MINIMUM_PASSWORD = 12

/**
 * What is wrong with a password, and with the box asking for it twice, or null
 * when there is nothing wrong.
 *
 * One function for every form that sets a password — registering, changing one,
 * and following a reset link — because all three want the same two sentences
 * and the confirmation box exists precisely so that a mistyped password is
 * caught here rather than at the next sign-in.
 */
export function passwordProblem(password: string, confirmation?: string): string | null {
  const chosen = password ?? ''

  if (chosen.length < MINIMUM_PASSWORD) {
    return `A password is at least ${MINIMUM_PASSWORD} characters. Length is what makes one hard to guess.`
  }

  // Undefined means there is no confirmation box on this form; an empty string
  // means there is one and it has not been filled in.
  if (confirmation !== undefined && chosen !== confirmation) {
    return 'Those do not match. Type the same password in both boxes.'
  }

  return null
}
