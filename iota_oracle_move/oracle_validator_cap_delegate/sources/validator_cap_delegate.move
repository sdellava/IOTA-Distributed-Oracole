module iota_oracle_validator_cap_delegate::validator_cap_delegate {
    use iota_system::validator_cap::UnverifiedValidatorOperationCap;

    /// Delegated cap that can be used by external modules instead of requiring
    /// the validator's real operation cap at every call site.
    public struct DelegatedControllerCap has key, store {
        id: object::UID,
        validator_cap_id: object::ID,
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
        let delegated = DelegatedControllerCap {
            id: object::new(ctx),
            validator_cap_id: object::id(validator_cap),
        };
        transfer::public_transfer(delegated, recipient);
    }

    public fun validator_cap_id(cap: &DelegatedControllerCap): object::ID {
        cap.validator_cap_id
    }
}
