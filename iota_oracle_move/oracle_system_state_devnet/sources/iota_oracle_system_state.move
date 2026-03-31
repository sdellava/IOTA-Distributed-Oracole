module iota_oracle_system_state::systemState {
    use iota_system::iota_system::IotaSystemState;
    use iota_system::validator_cap::UnverifiedValidatorOperationCap;
    use iota::address;
    use iota::coin::{Self as coin, Coin};
    use iota::dynamic_field;
    use iota::clock::{Clock, timestamp_ms};
    use iota::event;
    use iota::iota::IOTA;
    use std::bcs;

    const ENotInCommittee: u64 = 1;
    const ENotFound: u64 = 3;
    const EOracleAddrTaken: u64 = 4;
    const EInvalidCapFormat: u64 = 5;
    const EFeeBpsTooHigh: u64 = 6;

    const ETemplateNotFound: u64 = 41;
    const ETemplateDisabled: u64 = 42;
    const EInputTooLarge: u64 = 43;
    const EInvalidRetentionDays: u64 = 44;
    const EDownloadTooLarge: u64 = 45;

    const EProposalExpired: u64 = 62;
    const EAlreadyApproved: u64 = 63;
    const ENoOracleNodesRegistered: u64 = 64;
    const EInvalidProposalTimeout: u64 = 65;
    const EInvalidProposalKind: u64 = 66;
    const EProposalNotFound: u64 = 67;

    const PROPOSAL_KIND_NONE: u8 = 0;
    const PROPOSAL_KIND_TEMPLATE_UPSERT: u8 = 1;
    const PROPOSAL_KIND_TEMPLATE_REMOVE: u8 = 2;

    const MIN_PROPOSAL_TIMEOUT_MS: u64 = 60_000;
    const MAX_PROPOSAL_TIMEOUT_MS: u64 = 7 * 24 * 60 * 60 * 1000;

    public struct OracleNode has copy, drop, store {
        validator: address,
        addr: address,
        pubkey: vector<u8>,
        accepted_template_ids: vector<u64>,
    }

    public struct OracleTreasuryBalanceKey has copy, drop, store {}

    public struct TaskTemplateKey has copy, drop, store {
        template_id: u64,
    }

    public struct TemplateProposalApprovalKey has copy, drop, store {
        proposal_id: u64,
        voter: address,
    }

    // Price governed by oracle nodes:
    // required_payment = max(min_payment, base_price_iota + retention_days * price_per_retention_day_iota)
    // for non-storage templates, allow_storage=0 and retention_days must be 0
    public struct TaskTemplate has copy, drop, store {
        template_id: u64,
        task_type: vector<u8>,
        is_enabled: u8,

        base_price_iota: u64,

        max_input_bytes: u64,
        max_output_bytes: u64,
        included_download_bytes: u64,
        price_per_download_byte_iota: u64,

        allow_storage: u8,
        min_retention_days: u64,
        max_retention_days: u64,
        price_per_retention_day_iota: u64,
    }

    public struct TaskTemplateProposal has copy, drop, store {
        proposal_id: u64,
        proposal_kind: u8,
        deadline_ms: u64,
        approvals: u64,
        electorate_size: u64,

        template_id: u64,
        task_type: vector<u8>,
        is_enabled: u8,
        base_price_iota: u64,
        max_input_bytes: u64,
        max_output_bytes: u64,
        included_download_bytes: u64,
        price_per_download_byte_iota: u64,
        allow_storage: u8,
        min_retention_days: u64,
        max_retention_days: u64,
        price_per_retention_day_iota: u64,
    }

    // Renamed from Status -> State
    public struct State has key, store {
        id: object::UID,
        payload: vector<u8>,
        oracle_nodes: vector<OracleNode>,

        // config economica globale minima
        system_fee_bps: u64,
        min_payment: u64,

        // proposals
        template_proposal_id: u64,
        template_proposals: vector<TaskTemplateProposal>,
    }

    // Oggetto separato che riceve i fondi dei task
    public struct OracleTreasury has key, store {
        id: object::UID,
    }

    public struct ControllerCap has key, store { id: object::UID }

    public struct TaskTemplateProposalCreated has copy, drop {
        proposal_id: u64,
        proposal_kind: u8,
        template_id: u64,
        proposer: address,
        deadline_ms: u64,
        electorate_size: u64,
        approvals_needed: u64,
    }

    public struct TaskTemplateProposalApproved has copy, drop {
        proposal_id: u64,
        proposal_kind: u8,
        template_id: u64,
        by: address,
        approvals: u64,
        approvals_needed: u64,
    }

    public struct TaskTemplateProposalApplied has copy, drop {
        proposal_id: u64,
        proposal_kind: u8,
        template_id: u64,
        approvals: u64,
        approvals_needed: u64,
    }

    public struct TaskTemplateProposalExpired has copy, drop {
        proposal_id: u64,
        proposal_kind: u8,
        template_id: u64,
    }

    public struct TaskTemplateUpserted has copy, drop {
        template_id: u64,
        is_enabled: u8,
    }

    public struct TaskTemplateRemoved has copy, drop {
        template_id: u64,
    }

    public struct OracleTreasuryDeposited has copy, drop {
        from: address,
        amount: u64,
    }

    public struct OracleTreasuryWithdrawn has copy, drop {
        to: address,
        amount: u64,
    }

    fun init(ctx: &mut TxContext) {
        let sender = iota::tx_context::sender(ctx);

        let st = State {
            id: object::new(ctx),
            payload: b"{}",
            oracle_nodes: vector::empty(),

            system_fee_bps: 500,
            min_payment: 0,

            template_proposal_id: 0,
            template_proposals: vector::empty(),
        };
        transfer::share_object(st);

        let treasury = OracleTreasury { id: object::new(ctx) };
        transfer::share_object(treasury);

        let cap = ControllerCap { id: object::new(ctx) };
        transfer::transfer(cap, sender);
    }

    public entry fun set_state(
        _cap: &ControllerCap,
        st: &mut State,
        payload: vector<u8>,
        _ctx: &mut TxContext
    ) {
        st.payload = payload;
    }

    public entry fun set_global_economic_config(
        _cap: &ControllerCap,
        st: &mut State,
        system_fee_bps: u64,
        min_payment: u64,
        _ctx: &mut TxContext
    ) {
        assert!(system_fee_bps <= 10_000, EFeeBpsTooHigh);
        st.system_fee_bps = system_fee_bps;
        st.min_payment = min_payment;
    }

    // =========================================================
    // TEMPLATE PRICING GOVERNANCE
    // =========================================================

    public entry fun propose_task_template_upsert(
        _cap: &ControllerCap,
        st: &mut State,
        clock: &Clock,
        proposal_timeout_ms: u64,
        template_id: u64,
        task_type: vector<u8>,
        is_enabled: u8,
        base_price_iota: u64,
        max_input_bytes: u64,
        max_output_bytes: u64,
        included_download_bytes: u64,
        price_per_download_byte_iota: u64,
        allow_storage: u8,
        min_retention_days: u64,
        max_retention_days: u64,
        price_per_retention_day_iota: u64,
        ctx: &mut TxContext
    ) {
        assert!(
            proposal_timeout_ms >= MIN_PROPOSAL_TIMEOUT_MS &&
            proposal_timeout_ms <= MAX_PROPOSAL_TIMEOUT_MS,
            EInvalidProposalTimeout
        );

        maybe_expire_template_proposals(st, clock);

        let electorate = vector::length(&st.oracle_nodes);
        assert!(electorate > 0, ENoOracleNodesRegistered);

        let now = timestamp_ms(clock);
        let pid = st.template_proposal_id + 1;
        st.template_proposal_id = pid;
        vector::push_back(&mut st.template_proposals, TaskTemplateProposal {
            proposal_id: pid,
            proposal_kind: PROPOSAL_KIND_TEMPLATE_UPSERT,
            deadline_ms: now + proposal_timeout_ms,
            approvals: 0,
            electorate_size: electorate,
            template_id,
            task_type,
            is_enabled,
            base_price_iota,
            max_input_bytes,
            max_output_bytes,
            included_download_bytes,
            price_per_download_byte_iota,
            allow_storage,
            min_retention_days,
            max_retention_days,
            price_per_retention_day_iota,
        });

        let proposer = iota::tx_context::sender(ctx);
        event::emit(TaskTemplateProposalCreated {
            proposal_id: pid,
            proposal_kind: PROPOSAL_KIND_TEMPLATE_UPSERT,
            template_id,
            proposer,
            deadline_ms: now + proposal_timeout_ms,
            electorate_size: electorate,
            approvals_needed: majority_threshold(electorate),
        });
    }

    public entry fun propose_task_template_remove(
        _cap: &ControllerCap,
        st: &mut State,
        clock: &Clock,
        proposal_timeout_ms: u64,
        template_id: u64,
        ctx: &mut TxContext
    ) {
        assert!(
            proposal_timeout_ms >= MIN_PROPOSAL_TIMEOUT_MS &&
            proposal_timeout_ms <= MAX_PROPOSAL_TIMEOUT_MS,
            EInvalidProposalTimeout
        );

        maybe_expire_template_proposals(st, clock);

        let electorate = vector::length(&st.oracle_nodes);
        assert!(electorate > 0, ENoOracleNodesRegistered);

        let now = timestamp_ms(clock);
        let pid = st.template_proposal_id + 1;
        st.template_proposal_id = pid;
        vector::push_back(&mut st.template_proposals, TaskTemplateProposal {
            proposal_id: pid,
            proposal_kind: PROPOSAL_KIND_TEMPLATE_REMOVE,
            deadline_ms: now + proposal_timeout_ms,
            approvals: 0,
            electorate_size: electorate,
            template_id,
            task_type: vector::empty(),
            is_enabled: 0,
            base_price_iota: 0,
            max_input_bytes: 0,
            max_output_bytes: 0,
            included_download_bytes: 0,
            price_per_download_byte_iota: 0,
            allow_storage: 0,
            min_retention_days: 0,
            max_retention_days: 0,
            price_per_retention_day_iota: 0,
        });

        let proposer = iota::tx_context::sender(ctx);
        event::emit(TaskTemplateProposalCreated {
            proposal_id: pid,
            proposal_kind: PROPOSAL_KIND_TEMPLATE_REMOVE,
            template_id,
            proposer,
            deadline_ms: now + proposal_timeout_ms,
            electorate_size: electorate,
            approvals_needed: majority_threshold(electorate),
        });
    }

    public entry fun approve_task_template_proposal(
        st: &mut State,
        clock: &Clock,
        proposal_id: u64,
        ctx: &mut TxContext
    ) {
        maybe_expire_template_proposals(st, clock);

        let sender = iota::tx_context::sender(ctx);
        assert!(has_node_ref(st, sender), ENotFound);

        let idx = find_proposal_index(st, proposal_id);
        assert!(idx < vector::length(&st.template_proposals), EProposalNotFound);

        let now = timestamp_ms(clock);

        let key = TemplateProposalApprovalKey {
            proposal_id,
            voter: sender,
        };
        assert!(
            !dynamic_field::exists_<TemplateProposalApprovalKey>(&st.id, key),
            EAlreadyApproved
        );

        dynamic_field::add<TemplateProposalApprovalKey, bool>(&mut st.id, key, true);
        let (proposal_kind, template_id, approvals, needed, upsert_enabled) = {
            let p = vector::borrow_mut(&mut st.template_proposals, idx);
            assert!(
                p.proposal_kind == PROPOSAL_KIND_TEMPLATE_UPSERT ||
                p.proposal_kind == PROPOSAL_KIND_TEMPLATE_REMOVE,
                EInvalidProposalKind
            );
            assert!(now <= p.deadline_ms, EProposalExpired);
            p.approvals = p.approvals + 1;
            (
                p.proposal_kind,
                p.template_id,
                p.approvals,
                majority_threshold(p.electorate_size),
                p.is_enabled,
            )
        };

        event::emit(TaskTemplateProposalApproved {
            proposal_id,
            proposal_kind,
            template_id,
            by: sender,
            approvals,
            approvals_needed: needed,
        });

        if (approvals >= needed) {
            if (proposal_kind == PROPOSAL_KIND_TEMPLATE_UPSERT) {
                apply_template_upsert(st, idx);
                event::emit(TaskTemplateUpserted {
                    template_id,
                    is_enabled: upsert_enabled,
                });
            } else {
                apply_template_remove(st, idx);
                event::emit(TaskTemplateRemoved {
                    template_id,
                });
            };

            event::emit(TaskTemplateProposalApplied {
                proposal_id,
                proposal_kind,
                template_id,
                approvals,
                approvals_needed: needed,
            });

            remove_proposal_at(st, idx);
        };
    }

    public entry fun close_expired_task_template_proposal(
        st: &mut State,
        clock: &Clock
    ) {
        maybe_expire_template_proposals(st, clock);
    }

    // =========================================================
    // TEMPLATE GETTERS + VALIDATION
    // =========================================================

    public fun has_task_template(st: &State, template_id: u64): bool {
        let key = TaskTemplateKey { template_id };
        dynamic_field::exists_<TaskTemplateKey>(&st.id, key)
    }

    public fun borrow_task_template(st: &State, template_id: u64): &TaskTemplate {
        let key = TaskTemplateKey { template_id };
        assert!(dynamic_field::exists_<TaskTemplateKey>(&st.id, key), ETemplateNotFound);
        dynamic_field::borrow<TaskTemplateKey, TaskTemplate>(&st.id, key)
    }

    public fun task_template_is_enabled(st: &State, template_id: u64): u8 {
        let tpl = borrow_task_template(st, template_id);
        tpl.is_enabled
    }

    public fun task_template_task_type(st: &State, template_id: u64): vector<u8> {
        let tpl = borrow_task_template(st, template_id);
        copy_bytes(&tpl.task_type)
    }

    public fun task_template_base_price_iota(st: &State, template_id: u64): u64 {
        let tpl = borrow_task_template(st, template_id);
        tpl.base_price_iota
    }

    public fun task_template_max_input_bytes(st: &State, template_id: u64): u64 {
        let tpl = borrow_task_template(st, template_id);
        tpl.max_input_bytes
    }

    public fun task_template_max_output_bytes(st: &State, template_id: u64): u64 {
        let tpl = borrow_task_template(st, template_id);
        tpl.max_output_bytes
    }

    public fun task_template_included_download_bytes(st: &State, template_id: u64): u64 {
        let tpl = borrow_task_template(st, template_id);
        tpl.included_download_bytes
    }

    public fun task_template_price_per_download_byte_iota(st: &State, template_id: u64): u64 {
        let tpl = borrow_task_template(st, template_id);
        tpl.price_per_download_byte_iota
    }

    public fun task_template_allow_storage(st: &State, template_id: u64): u8 {
        let tpl = borrow_task_template(st, template_id);
        tpl.allow_storage
    }

    public fun task_template_min_retention_days(st: &State, template_id: u64): u64 {
        let tpl = borrow_task_template(st, template_id);
        tpl.min_retention_days
    }

    public fun task_template_max_retention_days(st: &State, template_id: u64): u64 {
        let tpl = borrow_task_template(st, template_id);
        tpl.max_retention_days
    }

    public fun task_template_price_per_retention_day_iota(st: &State, template_id: u64): u64 {
        let tpl = borrow_task_template(st, template_id);
        tpl.price_per_retention_day_iota
    }

    public fun validate_task_request_and_get_payment(
        st: &State,
        template_id: u64,
        payload_bytes_len: u64,
        retention_days: u64,
        declared_download_bytes: u64
    ): u64 {
        assert!(has_task_template(st, template_id), ETemplateNotFound);
        assert!(task_template_is_enabled(st, template_id) == 1, ETemplateDisabled);
        assert!(payload_bytes_len <= task_template_max_input_bytes(st, template_id), EInputTooLarge);
        assert!(declared_download_bytes <= task_template_max_output_bytes(st, template_id), EDownloadTooLarge);

        let allow_storage = task_template_allow_storage(st, template_id);
        if (allow_storage == 0) {
            assert!(retention_days == 0, EInvalidRetentionDays);
        } else {
            let min_days = task_template_min_retention_days(st, template_id);
            let max_days = task_template_max_retention_days(st, template_id);
            assert!(retention_days >= min_days, EInvalidRetentionDays);
            assert!(retention_days <= max_days, EInvalidRetentionDays);
        };

        let included_download_bytes = task_template_included_download_bytes(st, template_id);
        let extra_download_bytes = saturating_sub_u64(declared_download_bytes, included_download_bytes);
        let download_price =
            extra_download_bytes * task_template_price_per_download_byte_iota(st, template_id);

        let raw =
            task_template_base_price_iota(st, template_id) +
            download_price +
            retention_days * task_template_price_per_retention_day_iota(st, template_id);

        max_u64(raw, st.min_payment)
    }

    // =========================================================
    // ORACLE NODES
    // =========================================================

   /*
    public entry fun register_oracle_node(
        st: &mut State,
        system: &mut IotaSystemState,
        validator_cap: &UnverifiedValidatorOperationCap,
        oracle_addr: address,
        pubkey: vector<u8>,
        accepted_template_ids: vector<u64>,
        _ctx: &mut TxContext
    ) {
        let validator = validator_address_from_cap(validator_cap);
        let committee = iota_system::iota_system::committee_validator_addresses(system);
        assert!(contains_addr(&committee, validator), ENotInCommittee);
        upsert_oracle_node(st, validator, oracle_addr, pubkey, accepted_template_ids);
    }
    */
    
    public entry fun register_oracle_node_dev(
        st: &mut State,
        oracle_addr: address,
        pubkey: vector<u8>,
        accepted_template_ids: vector<u64>,
        ctx: &mut TxContext
    ) {
        let sender = iota::tx_context::sender(ctx);
        upsert_oracle_node(st, sender, oracle_addr, pubkey, accepted_template_ids);
    }
    

    public entry fun unregister_oracle_node(st: &mut State, ctx: &mut TxContext) {
        let sender = iota::tx_context::sender(ctx);
        let removed = remove_node(st, sender);
        assert!(removed, ENotFound);
    }

    public entry fun unregister_oracle_node_dev(st: &mut State, ctx: &mut TxContext) {
        unregister_oracle_node(st, ctx);
    }

    public fun oracle_nodes(st: &State): &vector<OracleNode> { &st.oracle_nodes }
    public fun oracle_node_addr(n: &OracleNode): address { n.addr }
    public fun oracle_node_accepts_template(n: &OracleNode, template_id: u64): bool {
        contains_u64(&n.accepted_template_ids, template_id)
    }
    public fun oracle_node_accepted_templates(n: &OracleNode): &vector<u64> { &n.accepted_template_ids }
    public fun payload(st: &State): &vector<u8> { &st.payload }

    public fun system_fee_bps(st: &State): u64 { st.system_fee_bps }
    public fun min_payment(st: &State): u64 { st.min_payment }

    public fun template_proposal_active(st: &State): u8 { if (vector::length(&st.template_proposals) > 0) 1 else 0 }
    public fun template_proposal_id(st: &State): u64 { st.template_proposal_id }
    public fun template_proposal_kind(st: &State): u8 {
        if (vector::length(&st.template_proposals) == 0) PROPOSAL_KIND_NONE else vector::borrow(&st.template_proposals, 0).proposal_kind
    }
    public fun template_proposal_deadline_ms(st: &State): u64 {
        if (vector::length(&st.template_proposals) == 0) 0 else vector::borrow(&st.template_proposals, 0).deadline_ms
    }
    public fun template_proposal_approvals(st: &State): u64 {
        if (vector::length(&st.template_proposals) == 0) 0 else vector::borrow(&st.template_proposals, 0).approvals
    }
    public fun template_proposal_electorate_size(st: &State): u64 {
        if (vector::length(&st.template_proposals) == 0) 0 else vector::borrow(&st.template_proposals, 0).electorate_size
    }
    public fun proposed_template_id(st: &State): u64 {
        if (vector::length(&st.template_proposals) == 0) 0 else vector::borrow(&st.template_proposals, 0).template_id
    }

    // =========================================================
    // TREASURY
    // =========================================================

    public fun deposit_treasury_iota(treasury: &mut OracleTreasury, fee: Coin<IOTA>, from: address) {
        let amount = coin::value(&fee);
        let key = OracleTreasuryBalanceKey {};
        if (dynamic_field::exists_<OracleTreasuryBalanceKey>(&treasury.id, key)) {
            let bal: &mut Coin<IOTA> =
                dynamic_field::borrow_mut<OracleTreasuryBalanceKey, Coin<IOTA>>(&mut treasury.id, key);
            coin::join(bal, fee);
        } else {
            dynamic_field::add<OracleTreasuryBalanceKey, Coin<IOTA>>(&mut treasury.id, key, fee);
        };
        event::emit(OracleTreasuryDeposited { from, amount });
    }

    public entry fun withdraw_treasury_iota(
        _cap: &ControllerCap,
        treasury: &mut OracleTreasury,
        amount: u64,
        to: address,
        ctx: &mut TxContext
    ) {
        let key = OracleTreasuryBalanceKey {};
        let bal: &mut Coin<IOTA> =
            dynamic_field::borrow_mut<OracleTreasuryBalanceKey, Coin<IOTA>>(&mut treasury.id, key);
        let out = coin::split(bal, amount, ctx);
        transfer::public_transfer(out, to);
        event::emit(OracleTreasuryWithdrawn { to, amount });
    }

    public fun treasury_balance_iota(treasury: &OracleTreasury): u64 {
        let key = OracleTreasuryBalanceKey {};
        if (dynamic_field::exists_<OracleTreasuryBalanceKey>(&treasury.id, key)) {
            let bal: &Coin<IOTA> =
                dynamic_field::borrow<OracleTreasuryBalanceKey, Coin<IOTA>>(&treasury.id, key);
            coin::value(bal)
        } else {
            0
        }
    }

    // =========================================================
    // INTERNALS
    // =========================================================

    fun maybe_expire_template_proposals(st: &mut State, clock: &Clock) {
        if (vector::length(&st.template_proposals) == 0) return;
        let now = timestamp_ms(clock);
        let mut i = vector::length(&st.template_proposals);
        while (i > 0) {
            i = i - 1;
            let p = vector::borrow(&st.template_proposals, i);
            if (now > p.deadline_ms) {
                let pid = p.proposal_id;
                let kind = p.proposal_kind;
                let template_id = p.template_id;
                remove_proposal_at(st, i);
                event::emit(TaskTemplateProposalExpired {
                    proposal_id: pid,
                    proposal_kind: kind,
                    template_id,
                });
            };
        };
    }

    fun apply_template_upsert(st: &mut State, proposal_idx: u64) {
        let p = vector::borrow(&st.template_proposals, proposal_idx);
        let key = TaskTemplateKey { template_id: p.template_id };
        let tpl = TaskTemplate {
            template_id: p.template_id,
            task_type: copy_bytes(&p.task_type),
            is_enabled: p.is_enabled,
            base_price_iota: p.base_price_iota,
            max_input_bytes: p.max_input_bytes,
            max_output_bytes: p.max_output_bytes,
            included_download_bytes: p.included_download_bytes,
            price_per_download_byte_iota: p.price_per_download_byte_iota,
            allow_storage: p.allow_storage,
            min_retention_days: p.min_retention_days,
            max_retention_days: p.max_retention_days,
            price_per_retention_day_iota: p.price_per_retention_day_iota,
        };

        if (dynamic_field::exists_<TaskTemplateKey>(&st.id, key)) {
            let _old: TaskTemplate =
                dynamic_field::remove<TaskTemplateKey, TaskTemplate>(&mut st.id, key);
        };
        dynamic_field::add<TaskTemplateKey, TaskTemplate>(&mut st.id, key, tpl);
    }

    fun apply_template_remove(st: &mut State, proposal_idx: u64) {
        let p = vector::borrow(&st.template_proposals, proposal_idx);
        let key = TaskTemplateKey { template_id: p.template_id };
        assert!(dynamic_field::exists_<TaskTemplateKey>(&st.id, key), ETemplateNotFound);
        let _old: TaskTemplate =
            dynamic_field::remove<TaskTemplateKey, TaskTemplate>(&mut st.id, key);
    }

    fun remove_proposal_at(st: &mut State, idx: u64) {
        let last = vector::length(&st.template_proposals);
        if (last == 0) return;
        let last_idx = last - 1;
        if (idx != last_idx) {
            let tmp = *vector::borrow(&st.template_proposals, last_idx);
            *vector::borrow_mut(&mut st.template_proposals, idx) = tmp;
        };
        vector::pop_back(&mut st.template_proposals);
    }

    fun find_proposal_index(st: &State, proposal_id: u64): u64 {
        let mut i = 0;
        while (i < vector::length(&st.template_proposals)) {
            let p = vector::borrow(&st.template_proposals, i);
            if (p.proposal_id == proposal_id) return i;
            i = i + 1;
        };
        vector::length(&st.template_proposals)
    }

    fun majority_threshold(n: u64): u64 {
        (n / 2) + 1
    }

    fun has_node_ref(st: &State, a: address): bool {
        let mut i = 0;
        while (i < vector::length(&st.oracle_nodes)) {
            let n = vector::borrow(&st.oracle_nodes, i);
            if (n.addr == a) return true;
            i = i + 1;
        };
        false
    }

    fun upsert_oracle_node(
        st: &mut State,
        validator: address,
        oracle_addr: address,
        pubkey: vector<u8>,
        accepted_template_ids: vector<u64>,
    ) {
        let mut i = 0;
        while (i < vector::length(&st.oracle_nodes)) {
            let n = vector::borrow(&st.oracle_nodes, i);

            if (n.addr == oracle_addr && n.validator != validator) abort EOracleAddrTaken;

            if (n.validator == validator) {
                let n_mut = vector::borrow_mut(&mut st.oracle_nodes, i);
                n_mut.addr = oracle_addr;
                n_mut.pubkey = pubkey;
                n_mut.accepted_template_ids = accepted_template_ids;
                return
            };

            i = i + 1;
        };

        vector::push_back(&mut st.oracle_nodes, OracleNode { validator, addr: oracle_addr, pubkey, accepted_template_ids });
    }

    fun remove_node(st: &mut State, a: address): bool {
        let mut i = 0;
        while (i < vector::length(&st.oracle_nodes)) {
            let n = vector::borrow(&st.oracle_nodes, i);
            if (n.addr == a) {
                let last = vector::length(&st.oracle_nodes) - 1;
                if (i != last) {
                    let tmp = *vector::borrow(&st.oracle_nodes, last);
                    *vector::borrow_mut(&mut st.oracle_nodes, i) = tmp;
                };
                vector::pop_back(&mut st.oracle_nodes);
                return true
            };
            i = i + 1;
        };
        false
    }

    fun contains_addr(v: &vector<address>, a: address): bool {
        let mut i = 0;
        while (i < vector::length(v)) {
            if (*vector::borrow(v, i) == a) return true;
            i = i + 1;
        };
        false
    }

    fun contains_u64(v: &vector<u64>, x: u64): bool {
        let mut i = 0;
        while (i < vector::length(v)) {
            if (*vector::borrow(v, i) == x) return true;
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

    fun max_u64(a: u64, b: u64): u64 {
        if (a >= b) a else b
    }

    fun saturating_sub_u64(a: u64, b: u64): u64 {
        if (a >= b) a - b else 0
    }

    fun validator_address_from_cap(cap: &UnverifiedValidatorOperationCap): address {
        let bytes = bcs::to_bytes(cap);
        let n = vector::length(&bytes);
        let addr_len = address::length();
        assert!(n >= addr_len, EInvalidCapFormat);
        let start = n - addr_len;
        let mut out = vector::empty<u8>();
        let mut i = start;
        while (i < n) {
            vector::push_back(&mut out, *vector::borrow(&bytes, i));
            i = i + 1;
        };
        address::from_bytes(out)
    }
}
