module iota_oracle_tasks::oracle_task_runtime {

    public struct TaskRuntime has key, store {
        id: object::UID,
        task_id: object::ID,
        created_at_ms: u64,
        commit_deadline_ms: u64,
        reveal_deadline_ms: u64,
        data_deadline_ms: u64,
        mediation_attempts: u64,
        mediation_status: u8,
        mediation_variance: u64,
        mediation_seed_bytes: vector<u8>,
    }

    public fun new(
        task_id: object::ID,
        created_at_ms: u64,
        commit_deadline_ms: u64,
        reveal_deadline_ms: u64,
        data_deadline_ms: u64,
        ctx: &mut TxContext
    ): TaskRuntime {
        TaskRuntime {
            id: object::new(ctx),
            task_id,
            created_at_ms,
            commit_deadline_ms,
            reveal_deadline_ms,
            data_deadline_ms,
            mediation_attempts: 0,
            mediation_status: 0,
            mediation_variance: 0,
            mediation_seed_bytes: vector::empty<u8>(),
        }
    }

    public fun id_ref(v: &TaskRuntime): &object::UID {
        &v.id
    }

    public fun id(v: &TaskRuntime): object::ID {
        object::id(v)
    }

    public fun task_id(v: &TaskRuntime): object::ID {
        v.task_id
    }

    public fun created_at_ms(v: &TaskRuntime): u64 {
        v.created_at_ms
    }

    public fun commit_deadline_ms(v: &TaskRuntime): u64 {
        v.commit_deadline_ms
    }

    public fun reveal_deadline_ms(v: &TaskRuntime): u64 {
        v.reveal_deadline_ms
    }

    public fun data_deadline_ms(v: &TaskRuntime): u64 {
        v.data_deadline_ms
    }

    public fun mediation_attempts(v: &TaskRuntime): u64 {
        v.mediation_attempts
    }

    public fun mediation_status(v: &TaskRuntime): u8 {
        v.mediation_status
    }

    public fun mediation_variance(v: &TaskRuntime): u64 {
        v.mediation_variance
    }

    public fun mediation_seed_bytes(v: &TaskRuntime): &vector<u8> {
        &v.mediation_seed_bytes
    }

    public fun set_created_at_ms(v: &mut TaskRuntime, x: u64) {
        v.created_at_ms = x;
    }

    public fun set_commit_deadline_ms(v: &mut TaskRuntime, x: u64) {
        v.commit_deadline_ms = x;
    }

    public fun set_reveal_deadline_ms(v: &mut TaskRuntime, x: u64) {
        v.reveal_deadline_ms = x;
    }

    public fun set_data_deadline_ms(v: &mut TaskRuntime, x: u64) {
        v.data_deadline_ms = x;
    }

    public fun set_mediation_attempts(v: &mut TaskRuntime, x: u64) {
        v.mediation_attempts = x;
    }

    public fun set_mediation_status(v: &mut TaskRuntime, x: u8) {
        v.mediation_status = x;
    }

    public fun set_mediation_variance(v: &mut TaskRuntime, x: u64) {
        v.mediation_variance = x;
    }

    public fun set_mediation_seed_bytes(v: &mut TaskRuntime, x: vector<u8>) {
        v.mediation_seed_bytes = x;
    }

    public fun destroy(v: TaskRuntime) {
        let TaskRuntime {
            id,
            task_id: _,
            created_at_ms: _,
            commit_deadline_ms: _,
            reveal_deadline_ms: _,
            data_deadline_ms: _,
            mediation_attempts: _,
            mediation_status: _,
            mediation_variance: _,
            mediation_seed_bytes: _,
        } = v;
        object::delete(id);
    }
}
