// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

module iota_oracle_scheduler::oracle_scheduled_tasks {
    use iota::balance::{Self as balance, Balance};
    use iota::clock::{Clock, timestamp_ms};
    use iota::coin::{Self as coin, Coin};
    use iota::event;
    use iota::iota::IOTA;
    use iota::random::Random;
    use iota_system::iota_system::IotaSystemState;

    use iota_oracle_system_state::systemState;
    use iota_oracle_system_state::systemState::ControllerCap;
    use iota_oracle_tasks::oracle_tasks;

    const SCHEDULER_TEMPLATE_ID: u64 = 0;
    const MIN_INTERVAL_MS: u64 = 300000;
    const ROUND_TIMEOUT_MS: u64 = 60000;

    const STATUS_ACTIVE: u8 = 1;
    const STATUS_FROZEN: u8 = 2;
    const STATUS_CANCELLED: u8 = 9;
    const STATUS_ENDED: u8 = 10;

    const EInvalidTaskTemplate: u64 = 1000;
    const EInvalidScheduleWindow: u64 = 1001;
    const EInvalidInterval: u64 = 1002;
    const ENoSchedulerNodes: u64 = 1003;
    const EOwnerCapMismatch: u64 = 1004;
    const ETaskNotActive: u64 = 1005;
    const ETaskNotDue: u64 = 1006;
    const EInsufficientScheduledBalance: u64 = 1007;
    const EDeleteRequiresTerminalState: u64 = 1008;
    const ECancelRequiresLiveState: u64 = 1009;
    const EUnfreezeRequiresFrozenState: u64 = 1010;
    const ENotHeadScheduler: u64 = 1011;
    const ERoundStillOwnedByHead: u64 = 1012;

    public struct ScheduledTaskRegistry has key, store {
        id: object::UID,
        scheduled_task_ids: vector<object::ID>,
    }

    public struct SchedulerQueue has key, store {
        id: object::UID,
        nodes: vector<address>,
        active_round_started_ms: u64,
        last_round_completed_ms: u64,
        round_counter: u64,
    }

    public struct ScheduledTask has key, store {
        id: object::UID,
        creator: address,
        status: u8,
        template_id: u64,
        requested_nodes: u64,
        quorum_k: u64,
        payload: vector<u8>,
        retention_days: u64,
        declared_download_bytes: u64,
        mediation_mode: u8,
        variance_max: u64,
        create_result_controller_cap: u8,
        start_schedule_ms: u64,
        end_schedule_ms: u64,
        interval_ms: u64,
        last_run_ms: u64,
        next_run_ms: u64,
        last_scheduler_node: address,
        balance_iota: Balance<IOTA>,
    }

    public struct ScheduledTaskOwnerCap has key, store {
        id: object::UID,
        task_id: object::ID,
    }

    public struct ScheduledTaskCreated has copy, drop {
        scheduled_task_id: object::ID,
        creator: address,
        template_id: u64,
        start_schedule_ms: u64,
        end_schedule_ms: u64,
        interval_ms: u64,
        next_run_ms: u64,
        funded_iota: u64,
    }

    public struct ScheduledTaskSubmitted has copy, drop {
        scheduled_task_id: object::ID,
        created_task_id: object::ID,
        scheduler: address,
        scheduled_for_ms: u64,
        executed_at_ms: u64,
        next_run_ms: u64,
        scheduler_fee_iota: u64,
        status: u8,
    }

    public struct ScheduledTaskFunded has copy, drop {
        scheduled_task_id: object::ID,
        by: address,
        amount: u64,
        balance_after: u64,
    }

    public struct ScheduledTaskCancelled has copy, drop {
        scheduled_task_id: object::ID,
        by: address,
    }

    public struct ScheduledTaskFrozen has copy, drop {
        scheduled_task_id: object::ID,
        by: address,
    }

    public struct ScheduledTaskUnfrozen has copy, drop {
        scheduled_task_id: object::ID,
        by: address,
    }

    public struct ScheduledTaskEnded has copy, drop {
        scheduled_task_id: object::ID,
        at_ms: u64,
    }

    public struct ScheduledTaskDeleted has copy, drop {
        scheduled_task_id: object::ID,
        by: address,
        refunded_iota: u64,
    }

    public struct SchedulerQueueReconciled has copy, drop {
        queue_len: u64,
        head: address,
        by: address,
    }

    public struct SchedulerRoundAdvanced has copy, drop {
        by: address,
        previous_head: address,
        new_head: address,
        timed_out: u8,
        round_counter: u64,
    }

    public struct SchedulerRoundStarted has copy, drop {
        by: address,
        round_counter: u64,
        started_ms: u64,
        queue_len: u64,
    }

    public struct SchedulerRoundCompleted has copy, drop {
        by: address,
        round_counter: u64,
        completed_ms: u64,
        processed_tasks: u64,
        queue_len: u64,
    }

    fun init(ctx: &mut TxContext) {
        transfer::share_object(ScheduledTaskRegistry {
            id: object::new(ctx),
            scheduled_task_ids: vector::empty(),
        });
        transfer::share_object(SchedulerQueue {
            id: object::new(ctx),
            nodes: vector::empty(),
            active_round_started_ms: 0,
            last_round_completed_ms: 0,
            round_counter: 0,
        });
    }

    public entry fun reconcile_scheduler_queue(
        queue: &mut SchedulerQueue,
        st: &systemState::State,
        ctx: &mut TxContext
    ) {
        let mut next_nodes = vector::empty<address>();
        let existing_ref = &queue.nodes;
        let mut i = 0;
        while (i < vector::length(existing_ref)) {
            let addr = *vector::borrow(existing_ref, i);
            if (node_supports_scheduler(st, addr) && !contains_address(&next_nodes, addr)) {
                vector::push_back(&mut next_nodes, addr);
            };
            i = i + 1;
        };

        let nodes_ref = systemState::oracle_nodes(st);
        let mut j = 0;
        while (j < vector::length(nodes_ref)) {
            let node = vector::borrow(nodes_ref, j);
            if (systemState::oracle_node_accepts_template(node, SCHEDULER_TEMPLATE_ID)) {
                let addr = systemState::oracle_node_addr(node);
                if (!contains_address(&next_nodes, addr)) {
                    vector::push_back(&mut next_nodes, addr);
                };
            };
            j = j + 1;
        };

        queue.nodes = next_nodes;
        let head = if (vector::length(&queue.nodes) > 0) *vector::borrow(&queue.nodes, 0) else @0x0;
        event::emit(SchedulerQueueReconciled {
            queue_len: vector::length(&queue.nodes),
            head,
            by: tx_context::sender(ctx),
        });
    }

    public entry fun start_scheduler_round(
        queue: &mut SchedulerQueue,
        st: &systemState::State,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let now = timestamp_ms(clock);
        reconcile_queue_internal(queue, st);
        assert!(vector::length(&queue.nodes) > 0, ENoSchedulerNodes);
        let sender = tx_context::sender(ctx);
        assert!(*vector::borrow(&queue.nodes, 0) == sender, ENotHeadScheduler);
        queue.active_round_started_ms = now;
        queue.round_counter = queue.round_counter + 1;
        event::emit(SchedulerRoundStarted {
            by: sender,
            round_counter: queue.round_counter,
            started_ms: now,
            queue_len: vector::length(&queue.nodes),
        });
    }

    public entry fun advance_scheduler_queue(
        queue: &mut SchedulerQueue,
        st: &systemState::State,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let now = timestamp_ms(clock);
        reconcile_queue_internal(queue, st);
        assert!(vector::length(&queue.nodes) > 0, ENoSchedulerNodes);

        let sender = tx_context::sender(ctx);
        let previous_head = *vector::borrow(&queue.nodes, 0);
        let timed_out = if (sender == previous_head) {
            0
        } else {
            assert!(queue.active_round_started_ms > 0, ERoundStillOwnedByHead);
            assert!(now >= queue.active_round_started_ms + ROUND_TIMEOUT_MS, ERoundStillOwnedByHead);
            1
        };

        rotate_head_to_tail(&mut queue.nodes);
        reconcile_queue_internal(queue, st);
        assert!(vector::length(&queue.nodes) > 0, ENoSchedulerNodes);

        queue.active_round_started_ms = now;
        let new_head = *vector::borrow(&queue.nodes, 0);
        event::emit(SchedulerRoundAdvanced {
            by: sender,
            previous_head,
            new_head,
            timed_out,
            round_counter: queue.round_counter,
        });
    }

    public entry fun complete_scheduler_round(
        queue: &mut SchedulerQueue,
        st: &systemState::State,
        clock: &Clock,
        processed_tasks: u64,
        ctx: &mut TxContext
    ) {
        let now = timestamp_ms(clock);
        reconcile_queue_internal(queue, st);
        assert!(vector::length(&queue.nodes) > 0, ENoSchedulerNodes);
        let sender = tx_context::sender(ctx);
        assert!(*vector::borrow(&queue.nodes, 0) == sender, ENotHeadScheduler);

        queue.last_round_completed_ms = now;
        queue.active_round_started_ms = 0;
        rotate_head_to_tail(&mut queue.nodes);
        reconcile_queue_internal(queue, st);

        event::emit(SchedulerRoundCompleted {
            by: sender,
            round_counter: queue.round_counter,
            completed_ms: now,
            processed_tasks,
            queue_len: vector::length(&queue.nodes),
        });
    }

    public entry fun create_scheduled_task(
        registry: &mut ScheduledTaskRegistry,
        st: &systemState::State,
        initial_funds: Coin<IOTA>,
        template_id: u64,
        requested_nodes: u64,
        quorum_k: u64,
        payload: vector<u8>,
        retention_days: u64,
        declared_download_bytes: u64,
        mediation_mode: u8,
        variance_max: u64,
        create_result_controller_cap: u8,
        start_schedule_ms: u64,
        end_schedule_ms: u64,
        interval_ms: u64,
        ctx: &mut TxContext
    ) {
        assert!(template_id != SCHEDULER_TEMPLATE_ID, EInvalidTaskTemplate);
        assert!(count_scheduler_nodes(st) > 0, ENoSchedulerNodes);
        assert!(interval_ms >= MIN_INTERVAL_MS, EInvalidInterval);
        assert!(end_schedule_ms == 0 || start_schedule_ms <= end_schedule_ms, EInvalidScheduleWindow);
        let (_, _, _) = systemState::validate_task_request_and_get_payment_split(
            st,
            template_id,
            vector::length(&payload),
            retention_days,
            declared_download_bytes
        );

        let creator = tx_context::sender(ctx);
        let funded_iota = coin::value(&initial_funds);
        let uid = object::new(ctx);
        let scheduled_task_id = object::uid_to_inner(&uid);

        let task = ScheduledTask {
            id: uid,
            creator,
            status: STATUS_ACTIVE,
            template_id,
            requested_nodes,
            quorum_k,
            payload,
            retention_days,
            declared_download_bytes,
            mediation_mode,
            variance_max,
            create_result_controller_cap,
            start_schedule_ms,
            end_schedule_ms,
            interval_ms,
            last_run_ms: 0,
            next_run_ms: start_schedule_ms,
            last_scheduler_node: @0x0,
            balance_iota: coin::into_balance(initial_funds),
        };

        vector::push_back(&mut registry.scheduled_task_ids, scheduled_task_id);
        transfer::share_object(task);
        transfer::public_transfer(
            ScheduledTaskOwnerCap { id: object::new(ctx), task_id: scheduled_task_id },
            creator
        );

        event::emit(ScheduledTaskCreated {
            scheduled_task_id,
            creator,
            template_id,
            start_schedule_ms,
            end_schedule_ms,
            interval_ms,
            next_run_ms: start_schedule_ms,
            funded_iota,
        });
    }

    public entry fun top_up_scheduled_task(
        task: &mut ScheduledTask,
        funds: Coin<IOTA>,
        ctx: &mut TxContext
    ) {
        let amount = coin::value(&funds);
        let by = tx_context::sender(ctx);
        balance::join(&mut task.balance_iota, coin::into_balance(funds));
        event::emit(ScheduledTaskFunded {
            scheduled_task_id: object::id(task),
            by,
            amount,
            balance_after: balance::value(&task.balance_iota),
        });
    }

    public entry fun cancel_scheduled_task(
        cap: &ScheduledTaskOwnerCap,
        task: &mut ScheduledTask,
        ctx: &mut TxContext
    ) {
        assert!(cap.task_id == object::id(task), EOwnerCapMismatch);
        assert!(task.status == STATUS_ACTIVE || task.status == STATUS_FROZEN, ECancelRequiresLiveState);
        task.status = STATUS_CANCELLED;
        event::emit(ScheduledTaskCancelled {
            scheduled_task_id: object::id(task),
            by: tx_context::sender(ctx),
        });
    }

    public entry fun freeze_scheduled_task_by_controller(
        _cap: &ControllerCap,
        task: &mut ScheduledTask,
        ctx: &mut TxContext
    ) {
        assert!(task.status == STATUS_ACTIVE, ETaskNotActive);
        task.status = STATUS_FROZEN;
        event::emit(ScheduledTaskFrozen {
            scheduled_task_id: object::id(task),
            by: tx_context::sender(ctx),
        });
    }

    public entry fun unfreeze_scheduled_task_by_controller(
        _cap: &ControllerCap,
        task: &mut ScheduledTask,
        ctx: &mut TxContext
    ) {
        assert!(task.status == STATUS_FROZEN, EUnfreezeRequiresFrozenState);
        task.status = STATUS_ACTIVE;
        event::emit(ScheduledTaskUnfrozen {
            scheduled_task_id: object::id(task),
            by: tx_context::sender(ctx),
        });
    }

    public entry fun sync_scheduled_task_ended(
        task: &mut ScheduledTask,
        clock: &Clock
    ) {
        maybe_mark_ended(task, timestamp_ms(clock));
    }

    #[allow(lint(public_random))]
    public entry fun submit_scheduled_task(
        queue: &SchedulerQueue,
        task: &mut ScheduledTask,
        st: &mut systemState::State,
        system: &mut IotaSystemState,
        treasury: &mut systemState::OracleTreasury,
        rnd: &Random,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(vector::length(&queue.nodes) > 0, ENoSchedulerNodes);
        assert!(*vector::borrow(&queue.nodes, 0) == sender, ENotHeadScheduler);

        let now = timestamp_ms(clock);
        assert!(task.status == STATUS_ACTIVE, ETaskNotActive);
        maybe_mark_ended(task, now);
        assert!(task.status == STATUS_ACTIVE, ETaskNotActive);
        assert!(now >= task.next_run_ms, ETaskNotDue);

        let scheduler_fee_iota = systemState::task_template_scheduler_fee_iota(st, task.template_id);
        let required_payment = systemState::validate_task_request_and_get_payment(
            st,
            task.template_id,
            vector::length(&task.payload),
            task.retention_days,
            task.declared_download_bytes
        );
        let total_required = required_payment + scheduler_fee_iota;
        assert!(balance::value(&task.balance_iota) >= total_required, EInsufficientScheduledBalance);

        if (scheduler_fee_iota > 0) {
            let fee_balance = balance::split(&mut task.balance_iota, scheduler_fee_iota);
            transfer::public_transfer(coin::from_balance(fee_balance, ctx), sender);
        };

        let payment_balance = balance::split(&mut task.balance_iota, required_payment);
        let scheduled_for_ms = task.next_run_ms;
        let created_task_id = oracle_tasks::create_task_internal(
            st,
            system,
            treasury,
            coin::from_balance(payment_balance, ctx),
            rnd,
            clock,
            task.template_id,
            task.requested_nodes,
            task.quorum_k,
            copy_bytes(&task.payload),
            task.retention_days,
            task.declared_download_bytes,
            task.mediation_mode,
            task.variance_max,
            task.create_result_controller_cap,
            task.creator,
            ctx
        );

        task.last_run_ms = now;
        task.last_scheduler_node = sender;
        task.next_run_ms = advance_next_run(task.next_run_ms, task.interval_ms, now);

        if (task.end_schedule_ms != 0 && task.next_run_ms > task.end_schedule_ms) {
            task.status = STATUS_ENDED;
            event::emit(ScheduledTaskEnded {
                scheduled_task_id: object::id(task),
                at_ms: now,
            });
        };

        event::emit(ScheduledTaskSubmitted {
            scheduled_task_id: object::id(task),
            created_task_id,
            scheduler: sender,
            scheduled_for_ms,
            executed_at_ms: now,
            next_run_ms: task.next_run_ms,
            scheduler_fee_iota,
            status: task.status,
        });
    }

    public entry fun delete_scheduled_task_with_owner_cap(
        registry: &mut ScheduledTaskRegistry,
        cap: ScheduledTaskOwnerCap,
        task: ScheduledTask,
        ctx: &mut TxContext
    ) {
        let task_id = object::id(&task);
        assert!(cap.task_id == task_id, EOwnerCapMismatch);
        assert!(task.status == STATUS_CANCELLED || task.status == STATUS_ENDED, EDeleteRequiresTerminalState);
        remove_registry_id(&mut registry.scheduled_task_ids, task_id);
        destroy_scheduled_task_owner_cap(cap);

        let ScheduledTask {
            id,
            creator,
            status: _,
            template_id: _,
            requested_nodes: _,
            quorum_k: _,
            payload: _,
            retention_days: _,
            declared_download_bytes: _,
            mediation_mode: _,
            variance_max: _,
            create_result_controller_cap: _,
            start_schedule_ms: _,
            end_schedule_ms: _,
            interval_ms: _,
            last_run_ms: _,
            next_run_ms: _,
            last_scheduler_node: _,
            balance_iota,
        } = task;

        let refunded_iota = balance::value(&balance_iota);
        transfer::public_transfer(coin::from_balance(balance_iota, ctx), creator);
        object::delete(id);

        event::emit(ScheduledTaskDeleted {
            scheduled_task_id: task_id,
            by: tx_context::sender(ctx),
            refunded_iota,
        });
    }

    public fun registry_task_ids(registry: &ScheduledTaskRegistry): &vector<object::ID> {
        &registry.scheduled_task_ids
    }

    public fun scheduler_nodes(queue: &SchedulerQueue): &vector<address> { &queue.nodes }
    public fun scheduler_head(queue: &SchedulerQueue): address {
        if (vector::length(&queue.nodes) == 0) @0x0 else *vector::borrow(&queue.nodes, 0)
    }
    public fun scheduler_round_counter(queue: &SchedulerQueue): u64 { queue.round_counter }
    public fun scheduler_active_round_started_ms(queue: &SchedulerQueue): u64 { queue.active_round_started_ms }
    public fun scheduler_last_round_completed_ms(queue: &SchedulerQueue): u64 { queue.last_round_completed_ms }

    public fun status(task: &ScheduledTask): u8 { task.status }
    public fun next_run_ms(task: &ScheduledTask): u64 { task.next_run_ms }
    public fun creator(task: &ScheduledTask): address { task.creator }
    public fun balance_iota(task: &ScheduledTask): u64 { balance::value(&task.balance_iota) }

    fun reconcile_queue_internal(queue: &mut SchedulerQueue, st: &systemState::State) {
        let mut next_nodes = vector::empty<address>();
        let existing_ref = &queue.nodes;
        let mut i = 0;
        while (i < vector::length(existing_ref)) {
            let addr = *vector::borrow(existing_ref, i);
            if (node_supports_scheduler(st, addr) && !contains_address(&next_nodes, addr)) {
                vector::push_back(&mut next_nodes, addr);
            };
            i = i + 1;
        };

        let nodes_ref = systemState::oracle_nodes(st);
        let mut j = 0;
        while (j < vector::length(nodes_ref)) {
            let node = vector::borrow(nodes_ref, j);
            if (systemState::oracle_node_accepts_template(node, SCHEDULER_TEMPLATE_ID)) {
                let addr = systemState::oracle_node_addr(node);
                if (!contains_address(&next_nodes, addr)) {
                    vector::push_back(&mut next_nodes, addr);
                };
            };
            j = j + 1;
        };

        queue.nodes = next_nodes;
    }

    fun node_supports_scheduler(st: &systemState::State, addr: address): bool {
        let nodes_ref = systemState::oracle_nodes(st);
        let mut i = 0;
        while (i < vector::length(nodes_ref)) {
            let node = vector::borrow(nodes_ref, i);
            if (systemState::oracle_node_addr(node) == addr) {
                return systemState::oracle_node_accepts_template(node, SCHEDULER_TEMPLATE_ID)
            };
            i = i + 1;
        };
        false
    }

    fun count_scheduler_nodes(st: &systemState::State): u64 {
        let nodes_ref = systemState::oracle_nodes(st);
        let mut count = 0;
        let mut i = 0;
        while (i < vector::length(nodes_ref)) {
            let node = vector::borrow(nodes_ref, i);
            if (systemState::oracle_node_accepts_template(node, SCHEDULER_TEMPLATE_ID)) {
                count = count + 1;
            };
            i = i + 1;
        };
        count
    }

    fun maybe_mark_ended(task: &mut ScheduledTask, now: u64) {
        if (task.status == STATUS_CANCELLED || task.status == STATUS_ENDED) return;
        if (task.end_schedule_ms == 0) return;
        if (task.next_run_ms > task.end_schedule_ms) {
            task.status = STATUS_ENDED;
            event::emit(ScheduledTaskEnded {
                scheduled_task_id: object::id(task),
                at_ms: now,
            });
        };
    }

    fun advance_next_run(next_run_ms: u64, interval_ms: u64, now: u64): u64 {
        let mut next = next_run_ms;
        while (next <= now) {
            next = next + interval_ms;
        };
        next
    }

    fun rotate_head_to_tail(nodes: &mut vector<address>) {
        if (vector::length(nodes) <= 1) return;
        let head = *vector::borrow(nodes, 0);
        let last_idx = vector::length(nodes) - 1;
        let mut i = 1;
        while (i < vector::length(nodes)) {
            let addr = *vector::borrow(nodes, i);
            *vector::borrow_mut(nodes, i - 1) = addr;
            i = i + 1;
        };
        *vector::borrow_mut(nodes, last_idx) = head;
    }

    fun remove_registry_id(ids: &mut vector<object::ID>, target: object::ID) {
        let mut i = 0;
        while (i < vector::length(ids)) {
            if (*vector::borrow(ids, i) == target) {
                let last_idx = vector::length(ids) - 1;
                if (i != last_idx) {
                    let last = *vector::borrow(ids, last_idx);
                    *vector::borrow_mut(ids, i) = last;
                };
                vector::pop_back(ids);
                return
            };
            i = i + 1;
        };
    }

    fun destroy_scheduled_task_owner_cap(cap: ScheduledTaskOwnerCap) {
        let ScheduledTaskOwnerCap { id, task_id: _ } = cap;
        object::delete(id);
    }

    fun contains_address(addrs: &vector<address>, target: address): bool {
        let mut i = 0;
        while (i < vector::length(addrs)) {
            if (*vector::borrow(addrs, i) == target) return true;
            i = i + 1;
        };
        false
    }

    fun copy_bytes(v: &vector<u8>): vector<u8> {
        let mut out = vector::empty<u8>();
        let mut i = 0;
        while (i < vector::length(v)) {
            vector::push_back(&mut out, *vector::borrow(v, i));
            i = i + 1;
        };
        out
    }
}
