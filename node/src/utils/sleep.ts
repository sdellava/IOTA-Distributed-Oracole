// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
