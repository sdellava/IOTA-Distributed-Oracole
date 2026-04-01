module iota_oracle_validator_cap_delegate::validator_cap_delegate {
    use iota_system::validator_cap::UnverifiedValidatorOperationCap;
    use iota::address;
    use std::bcs;

    /// Delegated cap that can be used by external modules instead of requiring
    /// the validator's real operation cap at every call site.
    public struct DelegatedControllerCap has key, store {
        id: object::UID,
        validator_cap_id: object::ID,
        validator_address: address,
    }

    /// Mint a delegated controller cap and transfer it to `recipient`.
    ///
    /// Security model:
    /// - The transaction must be signed by the owner of `validator_cap`,
    ///   because the cap is passed by reference as an owned object input.
    /// - Therefore, successful execution proves the signer controls the
    ///   validator operation cap used to mint the delegation token.
    public entry fun mint_delegated_controller_cap(
        validator_cap: &UnverifiedValidatorOperationCap,
        recipient: address,
        ctx: &mut TxContext,
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
