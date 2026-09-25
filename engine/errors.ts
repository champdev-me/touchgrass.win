/** A refusal the player caused: a code agents can act on, a message and a hint. */
export class GameFail extends Error {
  constructor(public code: string, message: string, public hint?: string) {
    super(message);
  }
}
