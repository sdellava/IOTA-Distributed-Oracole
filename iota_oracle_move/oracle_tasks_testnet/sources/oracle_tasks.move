// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

module iota_oracle_tasks::oracle_tasks {
    use iota::balance::{Self as balance, Balance};
    use iota::clock::{Clock, timestamp_ms};
    use iota::coin::{Self as coin, Coin};
    use iota::event;
    use iota::iota::IOTA;
    use iota::random::{Random, RandomGenerator};
    use iota_system::iota_system::IotaSystemState;
    use std::hash;

    use iota_oracle_system_state::systemState;
    use iota_oracle_system_state::systemState::DelegatedControllerCap;
    use iota_oracle_tasks::oracle_task_config as task_config;
    use iota_oracle_tasks::oracle_task_consensus as consensus;
    use iota_oracle_tasks::oracle_task_runtime as task_runtime;

    const EInvalidPayload: u64 = 101;
    const ENotEnoughOracleNodes: u64 = 104;
    const EInvalidQuorum: u64 = 110;
    const EInsufficientPayment: u64 = 130;
    const EConfigMismatch: u64 = 131;
    const ERuntimeMismatch: u64 = 132;

    const ENotAssigned: u64 = 200;
    const EBadState: u64 = 210;
    const EAlreadyTerminal: u64 = 211;
    const EInvalidCertificate: u64 = 212;
    const ECertificateBelowQuorum: u64 = 213;
    const EDuplicateSigner: u64 = 214;
    const ESignerNotAssigned: u64 = 215;
    const EAbortReasonRequired: u64 = 217;
    const EMediationNotEnabled: u64 = 400;
    const EMediationAlreadyAttempted: u64 = 402;
    const EInvalidMediationMode: u64 = 403;
    const ETaskNotTerminalOrBlocked: u64 = 404;
    const EAlreadySettled: u64 = 405;
    const EInvalidFinalizeMode: u64 = 406;
    const EInvalidControllerCapFlag: u64 = 407;
    const ETaskOwnerCapMismatch: u64 = 408;
    const ETaskDeleteRequiresTerminalState: u64 = 409;
    const ETaskDeleteRequiresSettledFunds: u64 = 410;

    const STATE_OPEN: u8 = 1;
    const STATE_MEDIATION_PENDING: u8 = 2;
    const STATE_FINALIZED: u8 = 9;
    const STATE_FAILED: u8 = 10;

    const MEDIATION_NONE: u8 = 0;
    const MEDIATION_MEAN_U64: u8 = 1;

    const FINALIZE_DIRECT: u8 = 1;
    const FINALIZE_MEDIATED: u8 = 2;

    const LIFECYCLE_CREATED: u8 = 1;
    const LIFECYCLE_ASSIGNED: u8 = 2;
    const LIFECYCLE_MEDIATION_STARTED: u8 = 6;
    const LIFECYCLE_MEDIATION_BLOCKED: u8 = 7;
    const LIFECYCLE_FAILED: u8 = 8;
    const LIFECYCLE_COMPLETED: u8 = 9;
    const LIFECYCLE_SETTLED: u8 = 10;
    const LIFECYCLE_ESCROW_SWEPT: u8 = 11;

    // Suggested fail causes for the client/UI.
    const FAIL_ACCEPTANCE_TIMEOUT: u64 = 1001;
    const FAIL_COMMIT_TIMEOUT: u64 = 1002;
    const FAIL_REVEAL_NO_QUORUM: u64 = 1003;
    const FAIL_REVEAL_INVALID_SIGNATURE: u64 = 1004;
    const FAIL_PARTIAL_SIG_TIMEOUT: u64 = 1005;
    const FAIL_FINALIZE_TIMEOUT: u64 = 1006;
    const FAIL_MEDIATION_VARIANCE_TOO_HIGH: u64 = 1007;
    const FAIL_ABORTED_BY_QUORUM: u64 = 1099;

    public struct Task has key, store {
        id: object::UID,
        creator: address,
        state: u8,

        template_id: u64,
        task_type: vector<u8>,
        payload: vector<u8>,
        payment_iota: u64,
        escrow_iota: Balance<IOTA>,

        requested_nodes: u64,
        quorum_k: u64,
        assigned_nodes: vector<address>,

        active_round: u64,
        create_result_controller_cap: u8,
        finalization_mode: u8,
        result: vector<u8>,
        result_hash: vector<u8>,
        multisig_bytes: vector<u8>,
        multisig_addr: address,
        certificate_signers: vector<address>,
        certificate_blob: vector<u8>,
        reason_code: u64,
        settled: u8,

        config_id: object::ID,
        runtime_id: object::ID,
    }

    public struct TaskOwnerCap has key, store {
        id: object::UID,
        task_id: object::ID,
    }

    public struct TaskResultControllerCap has key, store {
        id: object::UID,
        task_id: object::ID,
        result: vector<u8>,
    }

    public struct TaskLifecycleEvent has copy, drop {
        task_id: object::ID,
        kind: u8,
        actor: address,
        round: u64,
        value0: u64,
        value1: u64,
        value2: u64,
        value3: u64,
        addr0: address,
    }

    #[allow(lint(public_random))]
    public entry fun create_task(
        st: &mut systemState::State,
        system: &mut IotaSystemState,
        _treasury: &mut systemState::OracleTreasury,
        mut payment: Coin<IOTA>,
        rnd: &Random,
        clock: &Clock,
        template_id: u64,
        requested_nodes: u64,
        quorum_k: u64,
        payload: vector<u8>,
        retention_days: u64,
        declared_download_bytes: u64,
        mediation_mode: u8,
        variance_max: u64,
        create_result_controller_cap: u8,
        ctx: &mut TxContext
    ) {
        systemState::prune_oracle_nodes_if_epoch_changed(st, system, ctx);
        assert!(vector::length(&payload) > 0, EInvalidPayload);
        assert!(
            mediation_mode == MEDIATION_NONE || mediation_mode == MEDIATION_MEAN_U64,
            EInvalidMediationMode
        );
        assert!(
            create_result_controller_cap == 0 || create_result_controller_cap == 1,
            EInvalidControllerCapFlag
        );

        let required_payment = systemState::validate_task_request_and_get_payment(
            st,
            template_id,
            vector::length(&payload),
            retention_days,
            declared_download_bytes
        );

        let paid = coin::value(&payment);
        assert!(paid >= required_payment, EInsufficientPayment);

        let task_type = systemState::task_template_task_type(st, template_id);

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

        assert!(requested_nodes > 0 && requested_nodes <= vector::length(&candidates), ENotEnoughOracleNodes);
        assert!(quorum_k > 0 && quorum_k <= requested_nodes, EInvalidQuorum);

        let mut g: RandomGenerator = iota::random::new_generator(rnd, ctx);
        iota::random::shuffle(&mut g, &mut candidates);

        let mut assigned = vector::empty<address>();
        let mut j = 0;
        while (j < requested_nodes) {
            vector::push_back(&mut assigned, *vector::borrow(&candidates, j));
            j = j + 1;
        };

        let sender = tx_context::sender(ctx);
        let now = timestamp_ms(clock);

        if (paid > required_payment) {
            let refund_amount = paid - required_payment;
            let refund = coin::split(&mut payment, refund_amount, ctx);
            transfer::public_transfer(refund, sender);
        };

        let task_uid = object::new(ctx);
        let task_id = object::uid_to_inner(&task_uid);

        let config = task_config::new(
            task_id,
            retention_days,
            declared_download_bytes,
            mediation_mode,
            variance_max,
            ctx
        );
        let config_id = object::id(&config);

        // Keep runtime/status in a separate object. Deadlines are no longer protocol-critical,
        // but we retain the object for status / mediation audit.
        let runtime = task_runtime::new(task_id, now, 0, 0, 0, ctx);
        let runtime_id = object::id(&runtime);

        let task = Task {
            id: task_uid,
            creator: sender,
            state: STATE_OPEN,

            template_id,
            task_type,
            payload,
            payment_iota: required_payment,
            escrow_iota: coin::into_balance(payment),

            requested_nodes,
            quorum_k,
            assigned_nodes: assigned,

            active_round: 0,
            create_result_controller_cap,
            finalization_mode: 0,
            result: vector::empty<u8>(),
            result_hash: vector::empty<u8>(),
            multisig_bytes: vector::empty<u8>(),
            multisig_addr: @0x0,
            certificate_signers: vector::empty<address>(),
            certificate_blob: vector::empty<u8>(),
            reason_code: 0,
            settled: 0,

            config_id,
            runtime_id,
        };

        let tid = object::id(&task);

        event::emit(TaskLifecycleEvent {
            task_id: tid,
            kind: LIFECYCLE_CREATED,
            actor: sender,
            round: 0,
            value0: template_id,
            value1: required_payment,
            value2: retention_days,
            value3: declared_download_bytes,
            addr0: @0x0,
        });

        let mut k = 0;
        while (k < vector::length(&task.assigned_nodes)) {
            event::emit(TaskLifecycleEvent {
                task_id: tid,
                kind: LIFECYCLE_ASSIGNED,
                actor: sender,
                round: 0,
                value0: 0,
                value1: 0,
                value2: 0,
                value3: 0,
                addr0: *vector::borrow(&task.assigned_nodes, k),
            });
            k = k + 1;
        };

        transfer::public_share_object(config);
        transfer::public_share_object(runtime);
        transfer::share_object(task);

        transfer::public_transfer(TaskOwnerCap { id: object::new(ctx), task_id: tid }, sender);
    }

    /// Marks that exact consensus was not reached and that the next round/result will be mediated off-chain.
    /// This is a small on-chain checkpoint for auditability; the mediation computation itself remains off-chain.
    public entry fun start_mediation(
        task: &mut Task,
        config: &task_config::TaskConfig,
        runtime: &mut task_runtime::TaskRuntime,
        clock: &Clock,
        observed_variance: u64,
        seed_bytes: vector<u8>,
        ctx: &mut TxContext
    ) {
        assert_config_match(task, config);
        assert_runtime_match(task, runtime);
        assert_openish(task);
        assert!(task_config::mediation_mode(config) == MEDIATION_MEAN_U64, EMediationNotEnabled);
        assert!(task_runtime::mediation_attempts(runtime) == 0, EMediationAlreadyAttempted);

        if (observed_variance > task_config::variance_max(config)) {
            task_runtime::set_mediation_attempts(runtime, 1);
            task_runtime::set_mediation_status(runtime, 2);
            task_runtime::set_mediation_variance(runtime, observed_variance);
            task_runtime::set_mediation_seed_bytes(runtime, seed_bytes);
            event::emit(TaskLifecycleEvent {
                task_id: object::id(task),
                kind: LIFECYCLE_MEDIATION_BLOCKED,
                actor: tx_context::sender(ctx),
                round: task.active_round,
                value0: observed_variance,
                value1: task_config::variance_max(config),
                value2: FAIL_MEDIATION_VARIANCE_TOO_HIGH,
                value3: 0,
                addr0: @0x0,
            });
            return
        };

        task.state = STATE_MEDIATION_PENDING;
        task.active_round = task.active_round + 1;

        task_runtime::set_mediation_attempts(runtime, 1);
        task_runtime::set_mediation_status(runtime, 1);
        task_runtime::set_mediation_variance(runtime, observed_variance);
        task_runtime::set_mediation_seed_bytes(runtime, seed_bytes);
        task_runtime::set_created_at_ms(runtime, timestamp_ms(clock));

        event::emit(TaskLifecycleEvent {
            task_id: object::id(task),
            kind: LIFECYCLE_MEDIATION_STARTED,
            actor: tx_context::sender(ctx),
            round: task.active_round,
            value0: observed_variance,
            value1: task_config::variance_max(config),
            value2: vector::length(task_runtime::mediation_seed_bytes(runtime)),
            value3: 0,
            addr0: @0x0,
        });
    }

    /// Finalizes the task from an off-chain certificate.
    ///
    /// IMPORTANT: this entry verifies quorum membership and uniqueness on-chain, but it does not
    /// cryptographically verify the multisig bytes. The cryptographic verification is expected to be
    /// performed off-chain by oracle nodes and clients until a native Move-side multisig verifier is added.
    public entry fun finalize_task_with_certificate(
        task: &mut Task,
        runtime: &mut task_runtime::TaskRuntime,
        result_bytes: vector<u8>,
        multisig_bytes: vector<u8>,
        multisig_addr: address,
        signer_addrs: vector<address>,
        certificate_blob: vector<u8>,
        finalize_mode: u8,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert_runtime_match(task, runtime);
        assert_openish(task);
        assert!(finalize_mode == FINALIZE_DIRECT || finalize_mode == FINALIZE_MEDIATED, EInvalidFinalizeMode);
        assert_assigned_sender(task, tx_context::sender(ctx));
        assert_valid_certificate(task, &signer_addrs, &multisig_bytes);

        let result_hash = hash::sha2_256(consensus::clone_bytes(&result_bytes));

        task.state = STATE_FINALIZED;
        task.finalization_mode = finalize_mode;
        task.result = result_bytes;
        task.result_hash = result_hash;
        task.multisig_bytes = multisig_bytes;
        task.multisig_addr = multisig_addr;
        task.certificate_signers = signer_addrs;
        task.certificate_blob = certificate_blob;
        task.reason_code = 0;

        // Reuse runtime as separate status/audit object.
        task_runtime::set_created_at_ms(runtime, timestamp_ms(clock));
        if (finalize_mode == FINALIZE_MEDIATED) {
            task_runtime::set_mediation_status(runtime, 1);
        };

        event::emit(TaskLifecycleEvent {
            task_id: object::id(task),
            kind: LIFECYCLE_COMPLETED,
            actor: tx_context::sender(ctx),
            round: task.active_round,
            value0: finalize_mode as u64,
            value1: vector::length(&task.certificate_signers),
            value2: task.quorum_k,
            value3: vector::length(&task.result_hash),
            addr0: task.multisig_addr,
        });

        if (task.create_result_controller_cap == 1) {
            transfer::public_transfer(
                TaskResultControllerCap {
                    id: object::new(ctx),
                    task_id: object::id(task),
                    result: consensus::clone_bytes(&task.result),
                },
                task.creator,
            );
        };

        settle_task_funds(task, ctx);
    }

    /// Records a quorum-backed abort certificate.
    public entry fun abort_task_with_certificate(
        task: &mut Task,
        runtime: &mut task_runtime::TaskRuntime,
        reason_code: u64,
        multisig_bytes: vector<u8>,
        multisig_addr: address,
        signer_addrs: vector<address>,
        certificate_blob: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert_runtime_match(task, runtime);
        assert_openish(task);
        assert!(reason_code != 0, EAbortReasonRequired);
        assert_assigned_sender(task, tx_context::sender(ctx));
        assert_valid_certificate(task, &signer_addrs, &multisig_bytes);

        task.state = STATE_FAILED;
        task.finalization_mode = 0;
        task.result = vector::empty<u8>();
        task.result_hash = vector::empty<u8>();
        task.multisig_bytes = multisig_bytes;
        task.multisig_addr = multisig_addr;
        task.certificate_signers = signer_addrs;
        task.certificate_blob = certificate_blob;
        task.reason_code = reason_code;

        task_runtime::set_created_at_ms(runtime, timestamp_ms(clock));

        event::emit(TaskLifecycleEvent {
            task_id: object::id(task),
            kind: LIFECYCLE_FAILED,
            actor: tx_context::sender(ctx),
            round: task.active_round,
            value0: reason_code,
            value1: vector::length(&task.certificate_signers),
            value2: task.quorum_k,
            value3: 0,
            addr0: task.multisig_addr,
        });

        settle_task_funds(task, ctx);
    }

    public entry fun sweep_task_escrow_to_treasury_emergency(
        _cap: &DelegatedControllerCap,
        treasury: &mut systemState::OracleTreasury,
        task: &mut Task,
        ctx: &mut TxContext
    ) {
        assert!(task.state == STATE_FAILED || task.state == STATE_FINALIZED, ETaskNotTerminalOrBlocked);
        assert!(task.settled == 0, EAlreadySettled);

        let amount = balance::value(&task.escrow_iota);
        if (amount > 0) {
            let swept_balance = balance::split(&mut task.escrow_iota, amount);
            let swept = coin::from_balance(swept_balance, ctx);
            systemState::deposit_treasury_iota(treasury, swept, object::uid_to_address(&task.id));
        };
        task.settled = 1;

        event::emit(TaskLifecycleEvent {
            task_id: object::id(task),
            kind: LIFECYCLE_ESCROW_SWEPT,
            actor: tx_context::sender(ctx),
            round: 0,
            value0: amount,
            value1: 0,
            value2: 0,
            value3: 0,
            addr0: @0x0,
        });
    }

    public entry fun delete_task_with_owner_cap(
        cap: TaskOwnerCap,
        task: Task,
        config: task_config::TaskConfig,
        runtime: task_runtime::TaskRuntime
    ) {
        let task_id = object::id(&task);
        assert!(cap.task_id == task_id, ETaskOwnerCapMismatch);
        assert!(
            task.state == STATE_FINALIZED || task.state == STATE_FAILED,
            ETaskDeleteRequiresTerminalState
        );
        assert!(task.settled == 1, ETaskDeleteRequiresSettledFunds);
        assert!(task.config_id == task_config::id(&config), EConfigMismatch);
        assert!(task.runtime_id == task_runtime::id(&runtime), ERuntimeMismatch);
        assert!(task_config::task_id(&config) == task_id, EConfigMismatch);
        assert!(task_runtime::task_id(&runtime) == task_id, ERuntimeMismatch);

        destroy_task_owner_cap(cap);
        task_config::destroy(config);
        task_runtime::destroy(runtime);
        destroy_task(task);
    }

    public fun state(t: &Task): u8 { t.state }
    public fun creator(t: &Task): address { t.creator }
    public fun template_id(t: &Task): u64 { t.template_id }
    public fun task_type(t: &Task): &vector<u8> { &t.task_type }
    public fun payload(t: &Task): &vector<u8> { &t.payload }
    public fun payment_iota(t: &Task): u64 { t.payment_iota }
    public fun escrow_iota_value(t: &Task): u64 { balance::value(&t.escrow_iota) }
    public fun assigned_nodes(t: &Task): &vector<address> { &t.assigned_nodes }
    public fun requested_nodes(t: &Task): u64 { t.requested_nodes }
    public fun quorum_k(t: &Task): u64 { t.quorum_k }
    public fun active_round(t: &Task): u64 { t.active_round }
    public fun create_result_controller_cap(t: &Task): u8 { t.create_result_controller_cap }
    public fun finalization_mode(t: &Task): u8 { t.finalization_mode }
    public fun result(t: &Task): &vector<u8> { &t.result }
    public fun result_hash(t: &Task): &vector<u8> { &t.result_hash }
    public fun multisig_bytes(t: &Task): &vector<u8> { &t.multisig_bytes }
    public fun multisig_addr(t: &Task): address { t.multisig_addr }
    public fun certificate_signers(t: &Task): &vector<address> { &t.certificate_signers }
    public fun certificate_blob(t: &Task): &vector<u8> { &t.certificate_blob }
    public fun reason_code(t: &Task): u64 { t.reason_code }
    public fun settled(t: &Task): u8 { t.settled }
    public fun config_id(t: &Task): object::ID { t.config_id }
    public fun runtime_id(t: &Task): object::ID { t.runtime_id }

    public fun fail_acceptance_timeout(): u64 { FAIL_ACCEPTANCE_TIMEOUT }
    public fun fail_commit_timeout(): u64 { FAIL_COMMIT_TIMEOUT }
    public fun fail_reveal_no_quorum(): u64 { FAIL_REVEAL_NO_QUORUM }
    public fun fail_reveal_invalid_signature(): u64 { FAIL_REVEAL_INVALID_SIGNATURE }
    public fun fail_partial_sig_timeout(): u64 { FAIL_PARTIAL_SIG_TIMEOUT }
    public fun fail_finalize_timeout(): u64 { FAIL_FINALIZE_TIMEOUT }
    public fun fail_mediation_variance_too_high(): u64 { FAIL_MEDIATION_VARIANCE_TOO_HIGH }
    public fun fail_aborted_by_quorum(): u64 { FAIL_ABORTED_BY_QUORUM }

    fun assert_assigned_sender(task: &Task, sender: address) {
        assert!(consensus::contains_addr(&task.assigned_nodes, sender), ENotAssigned);
    }

    fun assert_openish(task: &Task) {
        assert!(task.state == STATE_OPEN || task.state == STATE_MEDIATION_PENDING, EBadState);
        assert!(task.state != STATE_FINALIZED && task.state != STATE_FAILED, EAlreadyTerminal);
    }

    fun assert_valid_certificate(task: &Task, signer_addrs: &vector<address>, multisig_bytes: &vector<u8>) {
        assert!(vector::length(signer_addrs) >= task.quorum_k, ECertificateBelowQuorum);
        assert!(!consensus::has_duplicates(signer_addrs), EDuplicateSigner);
        assert!(consensus::all_members_of(signer_addrs, &task.assigned_nodes), ESignerNotAssigned);
        assert!(vector::length(multisig_bytes) > 0, EInvalidCertificate);
    }

    fun assert_config_match(task: &Task, config: &task_config::TaskConfig) {
        assert!(task.config_id == task_config::id(config), EConfigMismatch);
    }

    fun assert_runtime_match(task: &Task, runtime: &task_runtime::TaskRuntime) {
        assert!(task.runtime_id == task_runtime::id(runtime), ERuntimeMismatch);
    }

    fun settle_task_funds(task: &mut Task, ctx: &mut TxContext) {
        if (task.settled == 1) return;
        let before = balance::value(&task.escrow_iota);
        pay_all_assigned_nodes(task, ctx);
        let after = balance::value(&task.escrow_iota);
        task.settled = 1;
        event::emit(TaskLifecycleEvent {
            task_id: object::id(task),
            kind: LIFECYCLE_SETTLED,
            actor: tx_context::sender(ctx),
            round: task.active_round,
            value0: task.state as u64,
            value1: vector::length(&task.assigned_nodes),
            value2: before - after,
            value3: after,
            addr0: @0x0,
        });
    }

    public fun is_assigned_node(t: &Task, addr: address): bool {
    let nodes = &t.assigned_nodes;
    let len = vector::length(nodes);
    let mut i = 0;
    while (i < len) {
        if (*vector::borrow(nodes, i) == addr) {
            return true
        };
        i = i + 1;
    };
    false
}

    fun pay_all_assigned_nodes(task: &mut Task, ctx: &mut TxContext) {
        let total = balance::value(&task.escrow_iota);
        let n = vector::length(&task.assigned_nodes);
        if (n == 0 || total == 0) return;

        let base_share = total / n;
        let remainder = total % n;

        let mut i = 0;
        while (i < n) {
            let addr = *vector::borrow(&task.assigned_nodes, i);
            let mut amount = base_share;
            if (i < remainder) {
                amount = amount + 1;
            };
            if (amount > 0) {
                let payout_balance = balance::split(&mut task.escrow_iota, amount);
                let payout = coin::from_balance(payout_balance, ctx);
                transfer::public_transfer(payout, addr);
            };
            i = i + 1;
        };
    }

    fun destroy_task_owner_cap(cap: TaskOwnerCap) {
        let TaskOwnerCap {
            id,
            task_id: _,
        } = cap;
        object::delete(id);
    }

    fun destroy_task(task: Task) {
        let Task {
            id,
            creator: _,
            state: _,
            template_id: _,
            task_type: _,
            payload: _,
            payment_iota: _,
            escrow_iota,
            requested_nodes: _,
            quorum_k: _,
            assigned_nodes: _,
            active_round: _,
            create_result_controller_cap: _,
            finalization_mode: _,
            result: _,
            result_hash: _,
            multisig_bytes: _,
            multisig_addr: _,
            certificate_signers: _,
            certificate_blob: _,
            reason_code: _,
            settled: _,
            config_id: _,
            runtime_id: _,
        } = task;
        balance::destroy_zero(escrow_iota);
        object::delete(id);
    }
}

