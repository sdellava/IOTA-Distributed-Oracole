// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { TaskHandler } from "../types";
import { extractDidFromPayload, resolveDidDocument, resolveDidInput, validateDlvcAndExtractDomain } from "./dlvc_helpers";

const INVALID = "DLVC INVALID";

export const handleTaskDlvcValidation: TaskHandler = async ({ payload }) => {
  const didRaw = String(extractDidFromPayload(payload ?? {}) ?? "").trim();
  try {
    const did = resolveDidInput(didRaw);
    if (!did) {
      return JSON.stringify({
        status: INVALID,
        did: didRaw,
        linked_domain: null,
      });
    }

    const didDocument = await resolveDidDocument(did);
    if (!didDocument) {
      return JSON.stringify({
        status: INVALID,
        did: did.didString,
        linked_domain: null,
      });
    }

    const linkedDomain = await validateDlvcAndExtractDomain(did, didDocument);
    return JSON.stringify({
      status: linkedDomain ? "DLVC VALID" : INVALID,
      did: did.didString,
      linked_domain: linkedDomain || null,
    });
  } catch {
    return JSON.stringify({
      status: INVALID,
      did: didRaw,
      linked_domain: null,
    });
  }
};
