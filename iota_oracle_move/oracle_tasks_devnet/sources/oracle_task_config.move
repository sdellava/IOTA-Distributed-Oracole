module iota_oracle_tasks::oracle_task_config {

    public struct TaskConfig has key, store {
        id: object::UID,
        task_id: object::ID,
        retention_days: u64,
        declared_download_bytes: u64,
        mediation_mode: u8,
        variance_max: u64,
    }

    public fun new(
        task_id: object::ID,
        retention_days: u64,
        declared_download_bytes: u64,
        mediation_mode: u8,
        variance_max: u64,
        ctx: &mut TxContext
    ): TaskConfig {
        TaskConfig {
            id: object::new(ctx),
            task_id,
            retention_days,
            declared_download_bytes,
            mediation_mode,
            variance_max,
        }
    }

    public fun id_ref(v: &TaskConfig): &object::UID {
        &v.id
    }

    public fun id(v: &TaskConfig): object::ID {
        object::id(v)
    }

    public fun task_id(v: &TaskConfig): object::ID {
        v.task_id
    }

    public fun retention_days(v: &TaskConfig): u64 {
        v.retention_days
    }

    public fun declared_download_bytes(v: &TaskConfig): u64 {
        v.declared_download_bytes
    }

    public fun mediation_mode(v: &TaskConfig): u8 {
        v.mediation_mode
    }

    public fun variance_max(v: &TaskConfig): u64 {
        v.variance_max
    }

    public fun destroy(v: TaskConfig) {
        let TaskConfig {
            id,
            task_id: _,
            retention_days: _,
            declared_download_bytes: _,
            mediation_mode: _,
            variance_max: _,
        } = v;
        object::delete(id);
    }
}
