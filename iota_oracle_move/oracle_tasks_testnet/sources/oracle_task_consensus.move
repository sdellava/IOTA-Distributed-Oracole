module iota_oracle_tasks::oracle_task_consensus {
    public fun contains_addr(v: &vector<address>, a: address): bool {
        let mut i = 0;
        while (i < vector::length(v)) {
            if (*vector::borrow(v, i) == a) return true;
            i = i + 1;
        };
        false
    }

    public fun bytes_eq(a: &vector<u8>, b: &vector<u8>): bool {
        if (vector::length(a) != vector::length(b)) return false;
        let mut i = 0;
        while (i < vector::length(a)) {
            if (*vector::borrow(a, i) != *vector::borrow(b, i)) return false;
            i = i + 1;
        };
        true
    }

    public fun clone_bytes(v: &vector<u8>): vector<u8> {
        let mut out = vector::empty<u8>();
        let mut i = 0;
        while (i < vector::length(v)) {
            vector::push_back(&mut out, *vector::borrow(v, i));
            i = i + 1;
        };
        out
    }

    public fun has_duplicates(v: &vector<address>): bool {
        let mut i = 0;
        while (i < vector::length(v)) {
            let a = *vector::borrow(v, i);
            let mut j = i + 1;
            while (j < vector::length(v)) {
                if (*vector::borrow(v, j) == a) return true;
                j = j + 1;
            };
            i = i + 1;
        };
        false
    }

    public fun all_members_of(candidate: &vector<address>, universe: &vector<address>): bool {
        let mut i = 0;
        while (i < vector::length(candidate)) {
            if (!contains_addr(universe, *vector::borrow(candidate, i))) return false;
            i = i + 1;
        };
        true
    }
}
