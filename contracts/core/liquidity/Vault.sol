// Neptune Mutual Protocol (https://neptunemutual.com)
// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.4.22 <0.9.0;

import "./VaultBase.sol";

/**
 * @title Cover Vault for Liquidity
 * @dev Liquidity providers can earn fees by adding stablecoin liquidity
 * to any cover contract. The cover pool is collectively owned by liquidity providers
 * where fees automatically get accumulated and compounded. <br /> <br />
 * **Fees** <br />
 *
 * - Cover fees paid in stablecoin get added to the liquidity pool.
 * - The protocol supplies a small portion of idle assets to lending protocols (v2).
 * - Flash loan interest also gets added back to the pool.
 * - To protect liquidity providers from cover incidents, they can redeem upto 25% of the cover payouts through NPM provision.
 * - To protect liquidity providers from cover incidents, they can redeem upto 25% of the cover payouts through `assurance token` allocation.
 */
contract Vault is VaultBase {
  constructor(
    IStore store,
    bytes32 coverKey,
    IERC20 liquidityToken
  ) VaultBase(store, coverKey, liquidityToken) {
    this;
  }
}
