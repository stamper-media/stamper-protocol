# Runbook: takedown request

Intake: `POST /v1/reports` (and the abuse mailbox). Stamps are immutable on-chain; Stamper controls only
what it serves and the advisory resolver flag.

1. Triage within 24 h: identify the stamp code, the claim and the legal basis. Keep the request.
2. Valid request: set the resolver flag (resolver owner key, api secret):
   `cast send $RESOLVER "setFlag(bytes32,uint8,string)" <stampId> 2 <reasonUri>` (`TakedownLegal` = 2;
   `Disputed` = 3). The api stops serving originals, previews and the mirror copy for flagged stamps; the
   verify page shows the record with the reason URI.
3. Remove the mirror object from the bucket and the local cache; FOC pieces stay in the data sets (piece
   removal is a payer action — schedule it from the laptop only when the law requires deletion).
4. Author withdrawal uses the same path (`POST /v1/stamps/{code}/withdraw` → `WithdrawnByAuthor` = 1).
5. Reply to the requester with the reason URI and log the action.
