module iota_oracle_tasks::oracle_messages {
    use iota::event;
    use iota_oracle_tasks::oracle_tasks;

    const ENotAssigned: u64 = 1;
    const ETaskTerminal: u64 = 2;
    const EEmptyPayload: u64 = 3;
    const EMessageTooLarge: u64 = 4;

    const KIND_ACCEPTANCE: u8 = 1;
    const KIND_COMMIT: u8 = 2;
    const KIND_REVEAL: u8 = 3;
    const KIND_PARTIAL_SIGNATURE: u8 = 4;
    const KIND_LEADER_INTENT: u8 = 5;
    const KIND_ABORT_INTENT: u8 = 6;
    const KIND_NO_COMMIT: u8 = 7;

    const STATE_FINALIZED: u8 = 9;
    const STATE_FAILED: u8 = 10;
    const MAX_NO_COMMIT_MESSAGE_BYTES: u64 = 256;

    public struct OracleMessage has copy, drop {
        task_id: object::ID,
        round: u64,
        kind: u8,
        sender: address,
        payload: vector<u8>,
        signature: vector<u8>,
        value0: u64,
        value1: u64,
        value2: u64,
    }

    public entry fun publish_acceptance(
        task: &oracle_tasks::Task,
        round: u64,
        acceptance_proof: vector<u8>,
        signature: vector<u8>,
        ctx: &mut TxContext
    ) {
        assert_open_and_assigned(task, tx_context::sender(ctx));
        assert!(vector::length(&acceptance_proof) > 0, EEmptyPayload);
        assert!(vector::length(&signature) > 0, EEmptyPayload);
        event::emit(OracleMessage {
            task_id: object::id(task),
            round,
            kind: KIND_ACCEPTANCE,
            sender: tx_context::sender(ctx),
            payload: acceptance_proof,
            signature,
            value0: 0,
            value1: 0,
            value2: 0,
        });
    }

    public entry fun publish_commit(
        task: &oracle_tasks::Task,
        round: u64,
        result_hash: vector<u8>,
        signature: vector<u8>,
        ctx: &mut TxContext
    ) {
        assert_open_and_assigned(task, tx_context::sender(ctx));
        assert!(vector::length(&result_hash) > 0, EEmptyPayload);
        assert!(vector::length(&signature) > 0, EEmptyPayload);
        event::emit(OracleMessage {
            task_id: object::id(task),
            round,
            kind: KIND_COMMIT,
            sender: tx_context::sender(ctx),
            payload: result_hash,
            signature,
            value0: 0,
            value1: 0,
            value2: 0,
        });
    }

    public entry fun publish_reveal(
        task: &oracle_tasks::Task,
        round: u64,
        normalized_result: vector<u8>,
        signature: vector<u8>,
        numeric_value: u64,
        has_numeric_value: u64,
        ctx: &mut TxContext
    ) {
        assert_open_and_assigned(task, tx_context::sender(ctx));
        assert!(vector::length(&normalized_result) > 0, EEmptyPayload);
        assert!(vector::length(&signature) > 0, EEmptyPayload);
        event::emit(OracleMessage {
            task_id: object::id(task),
            round,
            kind: KIND_REVEAL,
            sender: tx_context::sender(ctx),
            payload: normalized_result,
            signature,
            value0: numeric_value,
            value1: has_numeric_value,
            value2: 0,
        });
    }

    public entry fun publish_partial_signature(
        task: &oracle_tasks::Task,
        round: u64,
        partial_signature: vector<u8>,
        canonical_message_digest: vector<u8>,
        ctx: &mut TxContext
    ) {
        assert_open_and_assigned(task, tx_context::sender(ctx));
        assert!(vector::length(&partial_signature) > 0, EEmptyPayload);
        assert!(vector::length(&canonical_message_digest) > 0, EEmptyPayload);
        event::emit(OracleMessage {
            task_id: object::id(task),
            round,
            kind: KIND_PARTIAL_SIGNATURE,
            sender: tx_context::sender(ctx),
            payload: partial_signature,
            signature: canonical_message_digest,
            value0: 0,
            value1: 0,
            value2: 0,
        });
    }

    public entry fun publish_leader_intent(
        task: &oracle_tasks::Task,
        round: u64,
        finalize_mode: u64,
        details: vector<u8>,
        signature: vector<u8>,
        ctx: &mut TxContext
    ) {
        assert_open_and_assigned(task, tx_context::sender(ctx));
        assert!(vector::length(&signature) > 0, EEmptyPayload);
        event::emit(OracleMessage {
            task_id: object::id(task),
            round,
            kind: KIND_LEADER_INTENT,
            sender: tx_context::sender(ctx),
            payload: details,
            signature,
            value0: finalize_mode,
            value1: 0,
            value2: 0,
        });
    }

    public entry fun publish_abort_intent(
        task: &oracle_tasks::Task,
        round: u64,
        reason_code: u64,
        details: vector<u8>,
        signature: vector<u8>,
        ctx: &mut TxContext
    ) {
        assert_open_and_assigned(task, tx_context::sender(ctx));
        assert!(vector::length(&signature) > 0, EEmptyPayload);
        event::emit(OracleMessage {
            task_id: object::id(task),
            round,
            kind: KIND_ABORT_INTENT,
            sender: tx_context::sender(ctx),
            payload: details,
            signature,
            value0: reason_code,
            value1: 0,
            value2: 0,
        });
    }

    public entry fun publish_no_commit(
        task: &oracle_tasks::Task,
        round: u64,
        reason_code: u64,
        details: vector<u8>,
        ctx: &mut TxContext
    ) {
        assert_open_and_assigned(task, tx_context::sender(ctx));
        assert!(vector::length(&details) > 0, EEmptyPayload);
        assert!(vector::length(&details) <= MAX_NO_COMMIT_MESSAGE_BYTES, EMessageTooLarge);
        event::emit(OracleMessage {
            task_id: object::id(task),
            round,
            kind: KIND_NO_COMMIT,
            sender: tx_context::sender(ctx),
            payload: details,
            signature: vector::empty<u8>(),
            value0: reason_code,
            value1: 0,
            value2: 0,
        });
    }

    public fun kind_acceptance(): u8 { KIND_ACCEPTANCE }
    public fun kind_commit(): u8 { KIND_COMMIT }
    public fun kind_reveal(): u8 { KIND_REVEAL }
    public fun kind_partial_signature(): u8 { KIND_PARTIAL_SIGNATURE }
    public fun kind_leader_intent(): u8 { KIND_LEADER_INTENT }
    public fun kind_abort_intent(): u8 { KIND_ABORT_INTENT }
    public fun kind_no_commit(): u8 { KIND_NO_COMMIT }

    fun assert_open_and_assigned(task: &oracle_tasks::Task, sender: address) {
        let state = oracle_tasks::state(task);
        assert!(state != STATE_FINALIZED && state != STATE_FAILED, ETaskTerminal);
        assert!(oracle_tasks::is_assigned_node(task, sender), ENotAssigned);
    }
}
