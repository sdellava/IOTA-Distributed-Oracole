// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

module iota_oracle_validator_caps::validator_caps {
    use iota::address;
    use iota_system::validator_cap::UnverifiedValidatorOperationCap;
    use std::bcs;

    public struct DelegatedControllerCap has key, store {
        id: object::UID,
        validator_cap_id: object::ID,
        validator_address: address,
    }

    public entry fun mint_delegated_controller_cap(
        validator_cap: &UnverifiedValidatorOperationCap,
        recipient: address,
        ctx: &mut TxContext
    ) {
        let validator_address = validator_address_from_cap(validator_cap);
        let delegated = DelegatedControllerCap {
            id: object::new(ctx),
            validator_cap_id: object::id(validator_cap),
            validator_address,
        };
        transfer::public_transfer(delegated, recipient);
    }

    public fun validator_cap_id(cap: &DelegatedControllerCap): object::ID {
        cap.validator_cap_id
    }

    public fun validator_address(cap: &DelegatedControllerCap): address {
        cap.validator_address
    }

    public fun delete_delegated_controller_cap(cap: DelegatedControllerCap) {
        let DelegatedControllerCap {
            id,
            validator_cap_id: _,
            validator_address: _,
        } = cap;
        object::delete(id);
    }

    fun validator_address_from_cap(cap: &UnverifiedValidatorOperationCap): address {
        let bytes = bcs::to_bytes(cap);
        let n = vector::length(&bytes);
        let addr_len = address::length();
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
