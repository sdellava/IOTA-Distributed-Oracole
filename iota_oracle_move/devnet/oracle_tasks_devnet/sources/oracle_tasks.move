// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

module iota_oracle_tasks::oracle_tasks {
    use iota::balance::{Self as balance, Balance};
    use iota::clock::{Clock, timestamp_ms};
    use iota::coin::{Self as coin, Coin};
    use iota::dynamic_field;
    use iota::event;
    use iota::iota::IOTA;
    use iota::random::{Random, RandomGenerator};
    use iota_system::iota_system::IotaSystemState;
    use std::hash;

    use iota_oracle_system_state::systemState;
    use iota_oracle_system_state::systemState::{ControllerCap, State};
    use iota_oracle_tasks::oracle_task_consensus as consensus;

    const MIN_INTERVAL_MS: u64 = 300000;
    const ROUND_TIMEOUT_MS: u64 = 30000;
    const MAX_RESULT_HISTORY: u64 = 20;

    const STATUS_ACTIVE: u8 = 1;
    const STATUS_SUSPENDED: u8 = 2;
    const STATUS_CANCELLED: u8 = 9;
    const STATUS_ENDED: u8 = 10;

    const EXEC_IDLE: u8 = 0;
    const EXEC_OPEN: u8 = 1;
    const EXEC_MEDIATION_PENDING: u8 = 2;
    const EXEC_FINALIZED: u8 = 9;
    const EXEC_FAILED: u8 = 10;

    const MEDIATION_NONE: u8 = 0;
    const MEDIATION_MEAN_U64: u8 = 1;
    const FINALIZE_DIRECT: u8 = 1;
    const FINALIZE_MEDIATED: u8 = 2;

    const EInvalidTaskTemplate: u64 = 1000;
    const EInvalidScheduleWindow: u64 = 1001;
    const EInvalidInterval: u64 = 1002;
    const ENoSchedulerNodes: u64 = 1003;
    const EOwnerCapMismatch: u64 = 1004;
    const ETaskNotActive: u64 = 1005;
    const EDeleteRequiresSuspendedState: u64 = 1006;
    const ENotHeadScheduler: u64 = 1007;
    const ERoundStillOwnedByHead: u64 = 1008;
    const EInvalidPayload: u64 = 1009;
    const ENotEnoughOracleNodes: u64 = 1010;
    const EInvalidQuorum: u64 = 1011;
    const EInvalidMediationMode: u64 = 1012;
    const EInvalidControllerCapFlag: u64 = 1013;
    const ETaskOwnerMismatch: u64 = 1014;
    const ETaskHasLiveExecution: u64 = 1015;
    const ETaskNotSuspended: u64 = 1016;
    const ETaskNotDue: u64 = 1017;
    const EInsufficientTaskBalance: u64 = 1018;
    const EInvalidCertificate: u64 = 1019;
    const ECertificateBelowQuorum: u64 = 1020;
    const EDuplicateSigner: u64 = 1021;
    const ESignerNotAssigned: u64 = 1022;
    const EAbortReasonRequired: u64 = 1023;
    const EInvalidFinalizeMode: u64 = 1024;
    const ENoResults: u64 = 1025;
    const EResultIndexOutOfBounds: u64 = 1026;
    const EMediationNotEnabled: u64 = 1027;
    const EMediationAlreadyAttempted: u64 = 1028;

    public struct TaskRegistry has key, store {
        id: object::UID,
        live_task_ids: vector<object::ID>,
    }

    public struct SchedulerQueue has key, store {
        id: object::UID,
        nodes: vector<address>,
        active_round_started_ms: u64,
        last_round_completed_ms: u64,
        round_counter: u64,
    }

    public struct Task has key, store {
        id: object::UID,
        creator: address,
        status: u8,
        execution_state: u8,

        template_id: u64,
        task_type: vector<u8>,
        payload: vector<u8>,
        retention_days: u64,
        declared_download_bytes: u64,
        mediation_mode: u8,
        variance_max: u64,
        requested_nodes: u64,
        quorum_k: u64,

        create_controller_cap: u8,
        start_schedule_ms: u64,
        end_schedule_ms: u64,
        interval_ms: u64,
        last_run_ms: u64,
        next_run_ms: u64,
        last_scheduler_node: address,

        available_balance_iota: Balance<IOTA>,
        run_escrow_iota: Balance<IOTA>,

        active_run_index: u64,
        active_round: u64,
        assigned_nodes: vector<address>,

        latest_result_seq: u64,
        result_order: vector<u64>,
    }

    public struct TaskOwnerCap has key, store {
        id: object::UID,
        task_id: object::ID,
    }

    public struct TaskControllerCap has key, store {
        id: object::UID,
        task_id: object::ID,
    }

    public struct TaskResultKey has copy, drop, store {
        seq: u64,
    }

    public struct TaskResult has store, drop {
        run_index: u64,
        produced_at_ms: u64,
        result: vector<u8>,
        result_hash: vector<u8>,
        multisig_bytes: vector<u8>,
        multisig_addr: address,
        certificate_signers: vector<address>,
        certificate_blob: vector<u8>,
        reason_code: u64,
    }

    public struct TaskCreated has copy, drop {
        task_id: object::ID,
        creator: address,
        template_id: u64,
        start_schedule_ms: u64,
        end_schedule_ms: u64,
        interval_ms: u64,
        next_run_ms: u64,
        funded_iota: u64,
        has_controller_cap: u8,
    }

    public struct TaskUpdated has copy, drop {
        task_id: object::ID,
        by: address,
        requested_nodes: u64,
        quorum_k: u64,
        declared_download_bytes: u64,
        retention_days: u64,
        next_run_ms: u64,
    }

    public struct TaskSuspended has copy, drop {
        task_id: object::ID,
        by: address,
    }

    public struct TaskReactivated has copy, drop {
        task_id: object::ID,
        by: address,
        next_run_ms: u64,
    }

    public struct TaskDeleted has copy, drop {
        task_id: object::ID,
        by: address,
        refunded_iota: u64,
    }

    public struct TaskFunded has copy, drop {
        task_id: object::ID,
        by: address,
        amount: u64,
        balance_after: u64,
    }

    public struct TaskRunSubmitted has copy, drop {
        task_id: object::ID,
        scheduler: address,
        scheduled_for_ms: u64,
        executed_at_ms: u64,
        next_run_ms: u64,
        run_index: u64,
        scheduler_fee_iota: u64,
        payment_iota: u64,
        registry_live: u8,
    }

    public struct TaskRunMediationStarted has copy, drop {
        task_id: object::ID,
        by: address,
        run_index: u64,
        observed_variance: u64,
        variance_max: u64,
    }

    public struct TaskRunFinalized has copy, drop {
        task_id: object::ID,
        by: address,
        run_index: u64,
        finalization_mode: u8,
        result_seq: u64,
        signer_count: u64,
        next_run_ms: u64,
    }

    public struct TaskRunAborted has copy, drop {
        task_id: object::ID,
        by: address,
        run_index: u64,
        reason_code: u64,
        result_seq: u64,
        next_run_ms: u64,
    }

    public struct SchedulerQueueReconciled has copy, drop {
        queue_len: u64,
        head: address,
        by: address,
    }

    public struct SchedulerRoundStarted has copy, drop {
        by: address,
        round_counter: u64,
        started_ms: u64,
        queue_len: u64,
    }

    public struct SchedulerRoundAdvanced has copy, drop {
        by: address,
        previous_head: address,
        new_head: address,
        timed_out: u8,
        skipped_slots: u64,
        round_counter: u64,
    }

    public struct SchedulerRoundCompleted has copy, drop {
        by: address,
        round_counter: u64,
        completed_ms: u64,
        processed_tasks: u64,
        queue_len: u64,
    }

    fun init(ctx: &mut TxContext) {
        transfer::share_object(TaskRegistry {
            id: object::new(ctx),
            live_task_ids: vector::empty(),
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
        st: &State,
        ctx: &mut TxContext
    ) {
        reconcile_queue_internal(queue, st);
        let head = if (vector::length(&queue.nodes) > 0) *vector::borrow(&queue.nodes, 0) else @0x0;
        event::emit(SchedulerQueueReconciled {
            queue_len: vector::length(&queue.nodes),
            head,
            by: tx_context::sender(ctx),
        });
    }

    public entry fun start_scheduler_round(
        queue: &mut SchedulerQueue,
        st: &State,
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
        st: &State,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let now = timestamp_ms(clock);
        reconcile_queue_internal(queue, st);
        assert!(vector::length(&queue.nodes) > 0, ENoSchedulerNodes);

        let sender = tx_context::sender(ctx);
        let previous_head = *vector::borrow(&queue.nodes, 0);
        let sender_idx = find_address_index(&queue.nodes, sender);
        assert!(sender_idx < vector::length(&queue.nodes), ENotHeadScheduler);
        let skipped_slots = if (sender == previous_head) {
            1
        } else {
            assert!(sender_idx > 0, ENotHeadScheduler);
            assert!(queue.active_round_started_ms > 0, ERoundStillOwnedByHead);
            assert!(now >= queue.active_round_started_ms + (sender_idx * ROUND_TIMEOUT_MS), ERoundStillOwnedByHead);
            sender_idx
        };
        let timed_out = if (sender == previous_head) 0 else 1;

        let mut i = 0;
        while (i < skipped_slots) {
            rotate_head_to_tail(&mut queue.nodes);
            i = i + 1;
        };
        reconcile_queue_internal(queue, st);
        assert!(vector::length(&queue.nodes) > 0, ENoSchedulerNodes);

        queue.active_round_started_ms = now;
        event::emit(SchedulerRoundAdvanced {
            by: sender,
            previous_head,
            new_head: *vector::borrow(&queue.nodes, 0),
            timed_out,
            skipped_slots,
            round_counter: queue.round_counter,
        });
    }

    public entry fun complete_scheduler_round(
        queue: &mut SchedulerQueue,
        st: &State,
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
        rotate_head_to_tail(&mut queue.nodes);
        reconcile_queue_internal(queue, st);
        queue.active_round_started_ms = now;

        event::emit(SchedulerRoundCompleted {
            by: sender,
            round_counter: queue.round_counter,
            completed_ms: now,
            processed_tasks,
            queue_len: vector::length(&queue.nodes),
        });
    }

    public entry fun create_task(
        registry: &mut TaskRegistry,
        st: &State,
        initial_funds: Coin<IOTA>,
        template_id: u64,
        requested_nodes: u64,
        quorum_k: u64,
        payload: vector<u8>,
        retention_days: u64,
        declared_download_bytes: u64,
        mediation_mode: u8,
        variance_max: u64,
        create_controller_cap: u8,
        start_schedule_ms: u64,
        end_schedule_ms: u64,
        interval_ms: u64,
        ctx: &mut TxContext
    ) {
        assert!(template_id != 0, EInvalidTaskTemplate);
        assert!(count_scheduler_nodes(st) > 0, ENoSchedulerNodes);
        assert!(vector::length(&payload) > 0, EInvalidPayload);
        assert!(
            mediation_mode == MEDIATION_NONE || mediation_mode == MEDIATION_MEAN_U64,
            EInvalidMediationMode
        );
        assert!(
            create_controller_cap == 0 || create_controller_cap == 1,
            EInvalidControllerCapFlag
        );
        assert!(end_schedule_ms == 0 || start_schedule_ms <= end_schedule_ms, EInvalidScheduleWindow);
        if (interval_ms != 0) {
            assert!(interval_ms >= MIN_INTERVAL_MS, EInvalidInterval);
        };

        validate_request_shape(
            st,
            template_id,
            requested_nodes,
            quorum_k,
            &payload,
            retention_days,
            declared_download_bytes
        );

        let creator = tx_context::sender(ctx);
        let funded_iota = coin::value(&initial_funds);
        let uid = object::new(ctx);
        let task_id = object::uid_to_inner(&uid);
        let next_run_ms = initial_next_run_ms(start_schedule_ms, end_schedule_ms);

        let task = Task {
            id: uid,
            creator,
            status: if (next_run_ms == 0) STATUS_ENDED else STATUS_ACTIVE,
            execution_state: EXEC_IDLE,
            template_id,
            task_type: systemState::task_template_task_type(st, template_id),
            payload,
            retention_days,
            declared_download_bytes,
            mediation_mode,
            variance_max,
            requested_nodes,
            quorum_k,
            create_controller_cap,
            start_schedule_ms,
            end_schedule_ms,
            interval_ms,
            last_run_ms: 0,
            next_run_ms,
            last_scheduler_node: @0x0,
            available_balance_iota: coin::into_balance(initial_funds),
            run_escrow_iota: balance::zero(),
            active_run_index: 0,
            active_round: 0,
            assigned_nodes: vector::empty(),
            latest_result_seq: 0,
            result_order: vector::empty(),
        };

        if (next_run_ms != 0) {
            add_registry_id(&mut registry.live_task_ids, task_id);
        };

        transfer::share_object(task);
        transfer::public_transfer(TaskOwnerCap { id: object::new(ctx), task_id }, creator);
        if (create_controller_cap == 1) {
            transfer::public_transfer(TaskControllerCap { id: object::new(ctx), task_id }, creator);
        };

        event::emit(TaskCreated {
            task_id,
            creator,
            template_id,
            start_schedule_ms,
            end_schedule_ms,
            interval_ms,
            next_run_ms,
            funded_iota,
            has_controller_cap: create_controller_cap,
        });
    }

    public entry fun top_up_task(
        task: &mut Task,
        funds: Coin<IOTA>,
        ctx: &mut TxContext
    ) {
        let amount = coin::value(&funds);
        balance::join(&mut task.available_balance_iota, coin::into_balance(funds));
        event::emit(TaskFunded {
            task_id: object::id(task),
            by: tx_context::sender(ctx),
            amount,
            balance_after: balance::value(&task.available_balance_iota),
        });
    }

    public entry fun update_task_by_cap(
        registry: &mut TaskRegistry,
        cap: &TaskControllerCap,
        st: &State,
        task: &mut Task,
        requested_nodes: u64,
        quorum_k: u64,
        payload: vector<u8>,
        retention_days: u64,
        declared_download_bytes: u64,
        mediation_mode: u8,
        variance_max: u64,
        start_schedule_ms: u64,
        end_schedule_ms: u64,
        interval_ms: u64,
        ctx: &mut TxContext
    ) {
        assert!(cap.task_id == object::id(task), EOwnerCapMismatch);
        update_task_internal(
            registry,
            st,
            task,
            requested_nodes,
            quorum_k,
            payload,
            retention_days,
            declared_download_bytes,
            mediation_mode,
            variance_max,
            start_schedule_ms,
            end_schedule_ms,
            interval_ms,
            tx_context::sender(ctx),
        );
    }

    public entry fun update_task_by_owner(
        registry: &mut TaskRegistry,
        st: &State,
        task: &mut Task,
        requested_nodes: u64,
        quorum_k: u64,
        payload: vector<u8>,
        retention_days: u64,
        declared_download_bytes: u64,
        mediation_mode: u8,
        variance_max: u64,
        start_schedule_ms: u64,
        end_schedule_ms: u64,
        interval_ms: u64,
        ctx: &mut TxContext
    ) {
        assert_task_owner(task, tx_context::sender(ctx));
        update_task_internal(
            registry,
            st,
            task,
            requested_nodes,
            quorum_k,
            payload,
            retention_days,
            declared_download_bytes,
            mediation_mode,
            variance_max,
            start_schedule_ms,
            end_schedule_ms,
            interval_ms,
            tx_context::sender(ctx),
        );
    }

    public entry fun suspend_task_by_cap(
        registry: &mut TaskRegistry,
        cap: &TaskControllerCap,
        task: &mut Task,
        ctx: &mut TxContext
    ) {
        assert!(cap.task_id == object::id(task), EOwnerCapMismatch);
        suspend_task_internal(registry, task, tx_context::sender(ctx));
    }

    public entry fun suspend_task_by_owner(
        registry: &mut TaskRegistry,
        task: &mut Task,
        ctx: &mut TxContext
    ) {
        assert_task_owner(task, tx_context::sender(ctx));
        suspend_task_internal(registry, task, tx_context::sender(ctx));
    }

    public entry fun reactivate_task_by_cap(
        registry: &mut TaskRegistry,
        cap: &TaskControllerCap,
        task: &mut Task,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(cap.task_id == object::id(task), EOwnerCapMismatch);
        reactivate_task_internal(registry, task, timestamp_ms(clock), tx_context::sender(ctx));
    }

    public entry fun reactivate_task_by_owner(
        registry: &mut TaskRegistry,
        task: &mut Task,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert_task_owner(task, tx_context::sender(ctx));
        reactivate_task_internal(registry, task, timestamp_ms(clock), tx_context::sender(ctx));
    }

    public entry fun supervisor_suspend_task(
        registry: &mut TaskRegistry,
        _cap: &ControllerCap,
        task: &mut Task,
        ctx: &mut TxContext
    ) {
        suspend_task_internal(registry, task, tx_context::sender(ctx));
    }

    public entry fun delete_task_by_owner_cap(
        registry: &mut TaskRegistry,
        cap: TaskOwnerCap,
        task: Task,
        ctx: &mut TxContext
    ) {
        let task_id = object::id(&task);
        assert!(cap.task_id == task_id, EOwnerCapMismatch);
        destroy_task_owner_cap(cap);
        delete_task_internal(registry, task, tx_context::sender(ctx), ctx);
    }

    public entry fun delete_task_by_owner(
        registry: &mut TaskRegistry,
        task: Task,
        ctx: &mut TxContext
    ) {
        assert_task_owner_ref(&task, tx_context::sender(ctx));
        delete_task_internal(registry, task, tx_context::sender(ctx), ctx);
    }

    public entry fun delete_task_by_supervisor(
        registry: &mut TaskRegistry,
        _cap: &ControllerCap,
        task: Task,
        ctx: &mut TxContext
    ) {
        delete_task_internal(registry, task, tx_context::sender(ctx), ctx);
    }

    #[allow(lint(public_random))]
    public entry fun submit_task_run(
        registry: &mut TaskRegistry,
        queue: &SchedulerQueue,
        task: &mut Task,
        st: &mut State,
        system: &mut IotaSystemState,
        treasury: &mut systemState::OracleTreasury,
        rnd: &Random,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(vector::length(&queue.nodes) > 0, ENoSchedulerNodes);
        assert!(*vector::borrow(&queue.nodes, 0) == sender, ENotHeadScheduler);
        assert!(task.status == STATUS_ACTIVE, ETaskNotActive);
        assert!(task.execution_state != EXEC_OPEN && task.execution_state != EXEC_MEDIATION_PENDING, ETaskHasLiveExecution);

        let now = timestamp_ms(clock);
        assert!(task.next_run_ms != 0 && now >= task.next_run_ms, ETaskNotDue);

        systemState::prune_oracle_nodes_if_epoch_changed(st, system, ctx);
        validate_request_shape(
            st,
            task.template_id,
            task.requested_nodes,
            task.quorum_k,
            &task.payload,
            task.retention_days,
            task.declared_download_bytes
        );

        let (raw_payment, system_fee, required_payment) = systemState::validate_task_request_and_get_payment_split(
            st,
            task.template_id,
            vector::length(&task.payload),
            task.retention_days,
            task.declared_download_bytes
        );
        let scheduler_fee_iota = systemState::task_template_scheduler_fee_iota(st, task.template_id);
        let total_required = required_payment + scheduler_fee_iota;
        assert!(balance::value(&task.available_balance_iota) >= total_required, EInsufficientTaskBalance);

        if (scheduler_fee_iota > 0) {
            let fee_balance = balance::split(&mut task.available_balance_iota, scheduler_fee_iota);
            transfer::public_transfer(coin::from_balance(fee_balance, ctx), sender);
        };
        if (system_fee > 0) {
            let treasury_fee = balance::split(&mut task.available_balance_iota, system_fee);
            systemState::deposit_treasury_iota(
                treasury,
                coin::from_balance(treasury_fee, ctx),
                task.creator
            );
        };
        let new_run_escrow = balance::split(&mut task.available_balance_iota, raw_payment);
        balance::join(&mut task.run_escrow_iota, new_run_escrow);
        task.assigned_nodes = assign_nodes(st, task.template_id, task.requested_nodes, rnd, ctx);
        task.active_run_index = task.active_run_index + 1;
        task.active_round = 0;
        task.last_run_ms = now;
        task.last_scheduler_node = sender;
        task.execution_state = EXEC_OPEN;

        let scheduled_for_ms = task.next_run_ms;
        task.next_run_ms = compute_following_run_ms(task, scheduled_for_ms, now);
        reconcile_task_status(task);
        sync_registry_membership(registry, task);

        event::emit(TaskRunSubmitted {
            task_id: object::id(task),
            scheduler: sender,
            scheduled_for_ms,
            executed_at_ms: now,
            next_run_ms: task.next_run_ms,
            run_index: task.active_run_index,
            scheduler_fee_iota,
            payment_iota: raw_payment,
            registry_live: if (should_be_in_registry(task)) 1 else 0,
        });
    }

    public entry fun start_mediation(
        task: &mut Task,
        observed_variance: u64,
        ctx: &mut TxContext
    ) {
        assert!(task.execution_state == EXEC_OPEN || task.execution_state == EXEC_MEDIATION_PENDING, ETaskHasLiveExecution);
        assert!(task.mediation_mode == MEDIATION_MEAN_U64, EMediationNotEnabled);
        assert!(task.active_round == 0, EMediationAlreadyAttempted);
        assert_assigned_sender(task, tx_context::sender(ctx));

        task.execution_state = EXEC_MEDIATION_PENDING;
        task.active_round = task.active_round + 1;

        event::emit(TaskRunMediationStarted {
            task_id: object::id(task),
            by: tx_context::sender(ctx),
            run_index: task.active_run_index,
            observed_variance,
            variance_max: task.variance_max,
        });
    }

    public entry fun finalize_task_with_certificate(
        task: &mut Task,
        result_bytes: vector<u8>,
        multisig_bytes: vector<u8>,
        multisig_addr: address,
        signer_addrs: vector<address>,
        certificate_blob: vector<u8>,
        finalize_mode: u8,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(task.execution_state == EXEC_OPEN || task.execution_state == EXEC_MEDIATION_PENDING, ETaskHasLiveExecution);
        assert!(finalize_mode == FINALIZE_DIRECT || finalize_mode == FINALIZE_MEDIATED, EInvalidFinalizeMode);
        assert_assigned_sender(task, tx_context::sender(ctx));
        assert_valid_certificate(task, &signer_addrs, &multisig_bytes);

        let result_hash = hash::sha2_256(copy_bytes(&result_bytes));
        let signer_count = vector::length(&signer_addrs);
        let payout_signers = copy_addrs(&signer_addrs);
        let run_index = task.active_run_index;
        let result_seq = append_result_record(
            task,
            run_index,
            timestamp_ms(clock),
            result_bytes,
            result_hash,
            multisig_bytes,
            multisig_addr,
            signer_addrs,
            certificate_blob,
            0
        );
        pay_all_certificate_signers(task, &payout_signers, ctx);
        task.execution_state = EXEC_FINALIZED;

        event::emit(TaskRunFinalized {
            task_id: object::id(task),
            by: tx_context::sender(ctx),
            run_index,
            finalization_mode: finalize_mode,
            result_seq,
            signer_count,
            next_run_ms: task.next_run_ms,
        });
    }

    public entry fun abort_task_with_certificate(
        task: &mut Task,
        reason_code: u64,
        multisig_bytes: vector<u8>,
        multisig_addr: address,
        signer_addrs: vector<address>,
        certificate_blob: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(task.execution_state == EXEC_OPEN || task.execution_state == EXEC_MEDIATION_PENDING, ETaskHasLiveExecution);
        assert!(reason_code != 0, EAbortReasonRequired);
        assert_assigned_sender(task, tx_context::sender(ctx));
        assert_valid_certificate(task, &signer_addrs, &multisig_bytes);

        let payout_signers = copy_addrs(&signer_addrs);
        let run_index = task.active_run_index;
        let result_seq = append_result_record(
            task,
            run_index,
            timestamp_ms(clock),
            vector::empty(),
            vector::empty(),
            multisig_bytes,
            multisig_addr,
            signer_addrs,
            certificate_blob,
            reason_code
        );
        pay_all_certificate_signers(task, &payout_signers, ctx);
        task.execution_state = EXEC_FAILED;

        event::emit(TaskRunAborted {
            task_id: object::id(task),
            by: tx_context::sender(ctx),
            run_index,
            reason_code,
            result_seq,
            next_run_ms: task.next_run_ms,
        });
    }

    public fun registry_task_ids(registry: &TaskRegistry): &vector<object::ID> {
        &registry.live_task_ids
    }

    public fun scheduler_nodes(queue: &SchedulerQueue): &vector<address> { &queue.nodes }
    public fun scheduler_head(queue: &SchedulerQueue): address {
        if (vector::length(&queue.nodes) == 0) @0x0 else *vector::borrow(&queue.nodes, 0)
    }

    public fun status(task: &Task): u8 { task.status }
    public fun execution_state(task: &Task): u8 { task.execution_state }
    public fun state(task: &Task): u8 {
        if (task.execution_state == EXEC_OPEN) {
            1
        } else if (task.execution_state == EXEC_MEDIATION_PENDING) {
            2
        } else if (task.execution_state == EXEC_FINALIZED) {
            9
        } else if (task.execution_state == EXEC_FAILED) {
            10
        } else {
            0
        }
    }
    public fun next_run_ms(task: &Task): u64 { task.next_run_ms }
    public fun creator(task: &Task): address { task.creator }
    public fun available_balance_iota(task: &Task): u64 { balance::value(&task.available_balance_iota) }
    public fun run_escrow_iota(task: &Task): u64 { balance::value(&task.run_escrow_iota) }
    public fun active_round(task: &Task): u64 { task.active_round }
    public fun assigned_nodes(task: &Task): &vector<address> { &task.assigned_nodes }
    public fun result_sequences(task: &Task): &vector<u64> { &task.result_order }
    public fun result_count(task: &Task): u64 { vector::length(&task.result_order) }
    public fun latest_result_seq(task: &Task): u64 {
        assert!(task.latest_result_seq > 0, ENoResults);
        task.latest_result_seq
    }

    public fun borrow_result(task: &Task, seq: u64): &TaskResult {
        dynamic_field::borrow<TaskResultKey, TaskResult>(&task.id, TaskResultKey { seq })
    }

    public fun borrow_latest_result(task: &Task): &TaskResult {
        borrow_result(task, latest_result_seq(task))
    }

    public fun borrow_recent_result(task: &Task, reverse_index: u64): &TaskResult {
        let len = vector::length(&task.result_order);
        assert!(reverse_index < len, EResultIndexOutOfBounds);
        let seq = *vector::borrow(&task.result_order, len - 1 - reverse_index);
        borrow_result(task, seq)
    }

    public fun latest_result_bytes(task: &Task): &vector<u8> {
        &borrow_latest_result(task).result
    }

    public fun latest_result_hash(task: &Task): &vector<u8> {
        &borrow_latest_result(task).result_hash
    }

    public fun latest_result_reason_code(task: &Task): u64 {
        borrow_latest_result(task).reason_code
    }

    public fun append_result_for_testing(
        task: &mut Task,
        produced_at_ms: u64,
        result: vector<u8>,
        result_hash: vector<u8>,
        reason_code: u64
    ) {
        let run_index = task.active_run_index;
        let _ = append_result_record(
            task,
            run_index,
            produced_at_ms,
            result,
            result_hash,
            vector::empty(),
            @0x0,
            vector::empty(),
            vector::empty(),
            reason_code
        );
    }

    fun update_task_internal(
        registry: &mut TaskRegistry,
        st: &State,
        task: &mut Task,
        requested_nodes: u64,
        quorum_k: u64,
        payload: vector<u8>,
        retention_days: u64,
        declared_download_bytes: u64,
        mediation_mode: u8,
        variance_max: u64,
        start_schedule_ms: u64,
        end_schedule_ms: u64,
        interval_ms: u64,
        actor: address
    ) {
        assert!(task.execution_state != EXEC_OPEN && task.execution_state != EXEC_MEDIATION_PENDING, ETaskHasLiveExecution);
        assert!(vector::length(&payload) > 0, EInvalidPayload);
        assert!(
            mediation_mode == MEDIATION_NONE || mediation_mode == MEDIATION_MEAN_U64,
            EInvalidMediationMode
        );
        assert!(end_schedule_ms == 0 || start_schedule_ms <= end_schedule_ms, EInvalidScheduleWindow);
        if (interval_ms != 0) {
            assert!(interval_ms >= MIN_INTERVAL_MS, EInvalidInterval);
        };

        validate_request_shape(
            st,
            task.template_id,
            requested_nodes,
            quorum_k,
            &payload,
            retention_days,
            declared_download_bytes
        );

        task.payload = payload;
        task.retention_days = retention_days;
        task.declared_download_bytes = declared_download_bytes;
        task.mediation_mode = mediation_mode;
        task.variance_max = variance_max;
        task.requested_nodes = requested_nodes;
        task.quorum_k = quorum_k;
        task.start_schedule_ms = start_schedule_ms;
        task.end_schedule_ms = end_schedule_ms;
        task.interval_ms = interval_ms;

        if (task.last_run_ms == 0) {
            task.next_run_ms = initial_next_run_ms(start_schedule_ms, end_schedule_ms);
        } else if (task.interval_ms == 0) {
            task.next_run_ms = 0;
        } else {
            task.next_run_ms = compute_next_run_ms(task.last_run_ms, task.interval_ms, task.end_schedule_ms);
        };

        reconcile_task_status(task);
        sync_registry_membership(registry, task);

        event::emit(TaskUpdated {
            task_id: object::id(task),
            by: actor,
            requested_nodes,
            quorum_k,
            declared_download_bytes,
            retention_days,
            next_run_ms: task.next_run_ms,
        });
    }

    #[allow(lint(public_random))]
    fun assign_nodes(
        st: &State,
        template_id: u64,
        requested_nodes: u64,
        rnd: &Random,
        ctx: &mut TxContext
    ): vector<address> {
        let nodes_ref = systemState::oracle_nodes(st);
        let mut candidates = vector::empty<address>();
        let mut i = 0;
        while (i < vector::length(nodes_ref)) {
            let n = vector::borrow(nodes_ref, i);
            if (systemState::oracle_node_accepts_template(n, template_id)) {
                vector::push_back(&mut candidates, systemState::oracle_node_addr(n));
            };
            i = i + 1;
        };

        let mut g: RandomGenerator = iota::random::new_generator(rnd, ctx);
        iota::random::shuffle(&mut g, &mut candidates);

        let mut assigned = vector::empty<address>();
        let mut j = 0;
        while (j < requested_nodes) {
            vector::push_back(&mut assigned, *vector::borrow(&candidates, j));
            j = j + 1;
        };
        assigned
    }

    fun suspend_task_internal(
        registry: &mut TaskRegistry,
        task: &mut Task,
        actor: address
    ) {
        assert!(task.status == STATUS_ACTIVE, ETaskNotActive);
        task.status = STATUS_SUSPENDED;
        remove_registry_id(&mut registry.live_task_ids, object::id(task));
        event::emit(TaskSuspended {
            task_id: object::id(task),
            by: actor,
        });
    }

    fun reactivate_task_internal(
        registry: &mut TaskRegistry,
        task: &mut Task,
        now: u64,
        actor: address
    ) {
        assert!(task.status == STATUS_SUSPENDED, ETaskNotSuspended);
        if (task.next_run_ms == 0) {
            if (task.last_run_ms == 0) {
                task.next_run_ms = initial_next_run_ms(task.start_schedule_ms, task.end_schedule_ms);
            } else if (task.interval_ms != 0) {
                task.next_run_ms = compute_next_run_ms(now, task.interval_ms, task.end_schedule_ms);
            };
        };
        reconcile_task_status(task);
        if (task.status != STATUS_ENDED && task.status != STATUS_CANCELLED) {
            task.status = STATUS_ACTIVE;
        };
        sync_registry_membership(registry, task);
        event::emit(TaskReactivated {
            task_id: object::id(task),
            by: actor,
            next_run_ms: task.next_run_ms,
        });
    }

    fun delete_task_internal(
        registry: &mut TaskRegistry,
        mut task: Task,
        actor: address,
        ctx: &mut TxContext
    ) {
        let task_id = object::id(&task);
        assert!(task.status == STATUS_SUSPENDED, EDeleteRequiresSuspendedState);
        assert!(task.execution_state != EXEC_OPEN && task.execution_state != EXEC_MEDIATION_PENDING, ETaskHasLiveExecution);
        remove_registry_id(&mut registry.live_task_ids, task_id);

        destroy_results(&mut task.id, &mut task.result_order);

        let refund_available = balance::value(&task.available_balance_iota);
        if (refund_available > 0) {
            let out = balance::split(&mut task.available_balance_iota, refund_available);
            transfer::public_transfer(coin::from_balance(out, ctx), task.creator);
        };

        let refund_escrow = balance::value(&task.run_escrow_iota);
        if (refund_escrow > 0) {
            let out = balance::split(&mut task.run_escrow_iota, refund_escrow);
            transfer::public_transfer(coin::from_balance(out, ctx), task.creator);
        };

        let refunded_iota = refund_available + refund_escrow;
        let Task {
            id,
            creator: _,
            status: _,
            execution_state: _,
            template_id: _,
            task_type: _,
            payload: _,
            retention_days: _,
            declared_download_bytes: _,
            mediation_mode: _,
            variance_max: _,
            requested_nodes: _,
            quorum_k: _,
            create_controller_cap: _,
            start_schedule_ms: _,
            end_schedule_ms: _,
            interval_ms: _,
            last_run_ms: _,
            next_run_ms: _,
            last_scheduler_node: _,
            available_balance_iota,
            run_escrow_iota,
            active_run_index: _,
            active_round: _,
            assigned_nodes: _,
            latest_result_seq: _,
            result_order: _,
        } = task;
        balance::destroy_zero(available_balance_iota);
        balance::destroy_zero(run_escrow_iota);
        object::delete(id);

        event::emit(TaskDeleted {
            task_id,
            by: actor,
            refunded_iota,
        });
    }

    fun append_result_record(
        task: &mut Task,
        run_index: u64,
        produced_at_ms: u64,
        result: vector<u8>,
        result_hash: vector<u8>,
        multisig_bytes: vector<u8>,
        multisig_addr: address,
        certificate_signers: vector<address>,
        certificate_blob: vector<u8>,
        reason_code: u64
    ): u64 {
        let seq = task.latest_result_seq + 1;
        task.latest_result_seq = seq;
        dynamic_field::add<TaskResultKey, TaskResult>(
            &mut task.id,
            TaskResultKey { seq },
            TaskResult {
                run_index,
                produced_at_ms,
                result,
                result_hash,
                multisig_bytes,
                multisig_addr,
                certificate_signers,
                certificate_blob,
                reason_code,
            }
        );
        vector::push_back(&mut task.result_order, seq);
        trim_results(task);
        seq
    }

    fun trim_results(task: &mut Task) {
        while (vector::length(&task.result_order) > MAX_RESULT_HISTORY) {
            let oldest = *vector::borrow(&task.result_order, 0);
            let _old: TaskResult = dynamic_field::remove<TaskResultKey, TaskResult>(
                &mut task.id,
                TaskResultKey { seq: oldest }
            );
            remove_result_order_head(&mut task.result_order);
        };
    }

    fun destroy_results(task_id: &mut object::UID, result_order: &mut vector<u64>) {
        while (!vector::is_empty(result_order)) {
            let seq = vector::pop_back(result_order);
            let _old: TaskResult = dynamic_field::remove<TaskResultKey, TaskResult>(
                task_id,
                TaskResultKey { seq }
            );
        };
    }

    fun remove_result_order_head(values: &mut vector<u64>) {
        let len = vector::length(values);
        if (len == 0) return;
        let mut i = 1;
        while (i < len) {
            let v = *vector::borrow(values, i);
            *vector::borrow_mut(values, i - 1) = v;
            i = i + 1;
        };
        vector::pop_back(values);
    }

    fun sync_registry_membership(registry: &mut TaskRegistry, task: &Task) {
        let task_id = object::id(task);
        if (should_be_in_registry(task)) {
            add_registry_id(&mut registry.live_task_ids, task_id);
        } else {
            remove_registry_id(&mut registry.live_task_ids, task_id);
        };
    }

    fun should_be_in_registry(task: &Task): bool {
        task.status == STATUS_ACTIVE && task.next_run_ms != 0
    }

    fun reconcile_task_status(task: &mut Task) {
        if (task.status == STATUS_CANCELLED) return;
        if (task.next_run_ms == 0) {
            task.status = STATUS_ENDED;
        } else if (task.status == STATUS_ENDED) {
            task.status = STATUS_ACTIVE;
        };
    }

    fun compute_following_run_ms(task: &Task, scheduled_for_ms: u64, now: u64): u64 {
        if (task.interval_ms == 0) return 0;
        let mut next = scheduled_for_ms + task.interval_ms;
        while (next <= now) {
            next = next + task.interval_ms;
        };
        if (task.end_schedule_ms != 0 && next > task.end_schedule_ms) {
            0
        } else {
            next
        }
    }

    fun initial_next_run_ms(start_schedule_ms: u64, end_schedule_ms: u64): u64 {
        if (end_schedule_ms != 0 && start_schedule_ms > end_schedule_ms) {
            0
        } else {
            start_schedule_ms
        }
    }

    fun compute_next_run_ms(base_ms: u64, interval_ms: u64, end_schedule_ms: u64): u64 {
        let next = base_ms + interval_ms;
        if (end_schedule_ms != 0 && next > end_schedule_ms) {
            0
        } else {
            next
        }
    }

    fun validate_request_shape(
        st: &State,
        template_id: u64,
        requested_nodes: u64,
        quorum_k: u64,
        payload: &vector<u8>,
        retention_days: u64,
        declared_download_bytes: u64
    ) {
        let (_, _, _) = systemState::validate_task_request_and_get_payment_split(
            st,
            template_id,
            vector::length(payload),
            retention_days,
            declared_download_bytes
        );

        let nodes_ref = systemState::oracle_nodes(st);
        let mut supported_nodes = 0;
        let mut i = 0;
        while (i < vector::length(nodes_ref)) {
            let n = vector::borrow(nodes_ref, i);
            if (systemState::oracle_node_accepts_template(n, template_id)) {
                supported_nodes = supported_nodes + 1;
            };
            i = i + 1;
        };

        assert!(requested_nodes > 0 && requested_nodes <= supported_nodes, ENotEnoughOracleNodes);
        assert!(quorum_k > 0 && quorum_k <= requested_nodes, EInvalidQuorum);
    }

    fun assert_assigned_sender(task: &Task, sender: address) {
        assert!(consensus::contains_addr(&task.assigned_nodes, sender), ESignerNotAssigned);
    }

    public fun is_assigned_node(task: &Task, addr: address): bool {
        consensus::contains_addr(&task.assigned_nodes, addr)
    }

    fun assert_valid_certificate(task: &Task, signer_addrs: &vector<address>, multisig_bytes: &vector<u8>) {
        assert!(vector::length(signer_addrs) >= task.quorum_k, ECertificateBelowQuorum);
        assert!(!consensus::has_duplicates(signer_addrs), EDuplicateSigner);
        assert!(consensus::all_members_of(signer_addrs, &task.assigned_nodes), ESignerNotAssigned);
        assert!(vector::length(multisig_bytes) > 0, EInvalidCertificate);
    }

    fun pay_all_certificate_signers(
        task: &mut Task,
        certificate_signers: &vector<address>,
        ctx: &mut TxContext
    ) {
        let total = balance::value(&task.run_escrow_iota);
        let n = vector::length(certificate_signers);
        if (n == 0 || total == 0) return;

        let base_share = total / n;
        let remainder = total % n;
        let mut i = 0;
        while (i < n) {
            let addr = *vector::borrow(certificate_signers, i);
            let mut amount = base_share;
            if (i < remainder) {
                amount = amount + 1;
            };
            if (amount > 0) {
                let payout_balance = balance::split(&mut task.run_escrow_iota, amount);
                transfer::public_transfer(coin::from_balance(payout_balance, ctx), addr);
            };
            i = i + 1;
        };
    }

    fun reconcile_queue_internal(queue: &mut SchedulerQueue, st: &State) {
        let mut next_nodes = vector::empty<address>();
        let mut i = 0;
        while (i < vector::length(&queue.nodes)) {
            let addr = *vector::borrow(&queue.nodes, i);
            if (node_supports_scheduler(st, addr) && !contains_address(&next_nodes, addr)) {
                vector::push_back(&mut next_nodes, addr);
            };
            i = i + 1;
        };

        let nodes_ref = systemState::oracle_nodes(st);
        let mut j = 0;
        while (j < vector::length(nodes_ref)) {
            let node = vector::borrow(nodes_ref, j);
            let addr = systemState::oracle_node_addr(node);
            if (!contains_address(&next_nodes, addr)) {
                vector::push_back(&mut next_nodes, addr);
            };
            j = j + 1;
        };

        queue.nodes = next_nodes;
    }

    fun node_supports_scheduler(st: &State, addr: address): bool {
        let nodes_ref = systemState::oracle_nodes(st);
        let mut i = 0;
        while (i < vector::length(nodes_ref)) {
            let node = vector::borrow(nodes_ref, i);
            if (systemState::oracle_node_addr(node) == addr) {
                return true
            };
            i = i + 1;
        };
        false
    }

    fun count_scheduler_nodes(st: &State): u64 {
        let nodes_ref = systemState::oracle_nodes(st);
        let mut count = 0;
        let mut i = 0;
        while (i < vector::length(nodes_ref)) {
            let _node = vector::borrow(nodes_ref, i);
            count = count + 1;
            i = i + 1;
        };
        count
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

    fun find_address_index(nodes: &vector<address>, addr: address): u64 {
        let mut i = 0;
        while (i < vector::length(nodes)) {
            if (*vector::borrow(nodes, i) == addr) return i;
            i = i + 1;
        };
        vector::length(nodes)
    }

    fun add_registry_id(ids: &mut vector<object::ID>, target: object::ID) {
        if (!contains_id(ids, target)) {
            vector::push_back(ids, target);
        };
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

    fun contains_id(ids: &vector<object::ID>, target: object::ID): bool {
        let mut i = 0;
        while (i < vector::length(ids)) {
            if (*vector::borrow(ids, i) == target) return true;
            i = i + 1;
        };
        false
    }

    fun contains_address(addrs: &vector<address>, target: address): bool {
        let mut i = 0;
        while (i < vector::length(addrs)) {
            if (*vector::borrow(addrs, i) == target) return true;
            i = i + 1;
        };
        false
    }

    fun assert_task_owner(task: &Task, sender: address) {
        assert!(task.creator == sender, ETaskOwnerMismatch);
    }

    fun assert_task_owner_ref(task: &Task, sender: address) {
        assert!(task.creator == sender, ETaskOwnerMismatch);
    }

    fun destroy_task_owner_cap(cap: TaskOwnerCap) {
        let TaskOwnerCap { id, task_id: _ } = cap;
        object::delete(id);
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

    fun copy_addrs(v: &vector<address>): vector<address> {
        let mut out = vector::empty<address>();
        let mut i = 0;
        while (i < vector::length(v)) {
            vector::push_back(&mut out, *vector::borrow(v, i));
            i = i + 1;
        };
        out
    }
}
