/* eslint-disable no-unused-expressions */
const { ethers } = require('hardhat')
const BigNumber = require('bignumber.js')
const { helper, deployer, key } = require('../../../util')
const composer = require('../../../util/composer')
const { deployDependencies } = require('./deps')
const cxTokenUtil = require('../../../util/cxToken')

const cache = null
const DAYS = 86400
const PRECISION = helper.STABLECOIN_DECIMALS

require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bignumber')(BigNumber))
  .should()

describe('Policy: purchaseCover', () => {
  let deployed, coverKey

  before(async () => {
    const [owner] = await ethers.getSigners()
    deployed = await deployDependencies()

    deployed.policy = await deployer.deployWithLibraries(cache, 'Policy', {
      AccessControlLibV1: deployed.accessControlLibV1.address,
      BaseLibV1: deployed.baseLibV1.address,
      CoverUtilV1: deployed.coverUtilV1.address,
      PolicyHelperV1: deployed.policyHelperV1.address,
      ProtoUtilV1: deployed.protoUtilV1.address,
      StrategyLibV1: deployed.strategyLibV1.address,
      ValidationLibV1: deployed.validationLibV1.address
    }, deployed.store.address)

    await deployed.protocol.addContract(key.PROTOCOL.CNS.COVER_POLICY, deployed.policy.address)

    coverKey = key.toBytes32('foo-bar')
    const initialReassuranceAmount = helper.ether(1_000_000, PRECISION)
    const initialLiquidity = helper.ether(4_000_000, PRECISION)
    const stakeWithFee = helper.ether(10_000)
    const minStakeToReport = helper.ether(250)
    const reportingPeriod = 7 * DAYS
    const cooldownPeriod = 1 * DAYS
    const claimPeriod = 7 * DAYS
    const floor = helper.percentage(7)
    const ceiling = helper.percentage(45)
    const reassuranceRate = helper.percentage(50)
    const leverageFactor = '1'

    const requiresWhitelist = false

    const info = key.toBytes32('info')

    deployed.cover.updateCoverCreatorWhitelist(owner.address, true)

    await deployed.npm.approve(deployed.stakingContract.address, stakeWithFee)
    await deployed.dai.approve(deployed.cover.address, initialReassuranceAmount)

    await deployed.cover.addCover({
      coverKey,
      info,
      tokenName: 'POD',
      tokenSymbol: 'POD',
      supportsProducts: false,
      requiresWhitelist,
      stakeWithFee,
      initialReassuranceAmount,
      minStakeToReport,
      reportingPeriod,
      cooldownPeriod,
      claimPeriod,
      floor,
      ceiling,
      reassuranceRate,
      leverageFactor
    })

    deployed.vault = await composer.vault.getVault({
      store: deployed.store,
      libs: {
        accessControlLibV1: deployed.accessControlLibV1,
        baseLibV1: deployed.baseLibV1,
        transferLib: deployed.transferLib,
        protoUtilV1: deployed.protoUtilV1,
        registryLibV1: deployed.registryLibV1,
        validationLibV1: deployed.validationLibV1
      }
    }, coverKey)

    await deployed.dai.approve(deployed.vault.address, initialLiquidity)
    await deployed.npm.approve(deployed.vault.address, minStakeToReport)
    await deployed.vault.addLiquidity(coverKey, initialLiquidity, minStakeToReport, key.toBytes32(''))
  })

  it('must succeed without any errors', async () => {
    const [owner] = await ethers.getSigners()

    const amount = helper.ether(500_000, PRECISION)
    await deployed.dai.approve(deployed.policy.address, amount)

    const args = {
      onBehalfOf: owner.address,
      coverKey,
      productKey: helper.emptyBytes32,
      coverDuration: '1',
      amountToCover: amount,
      referralCode: key.toBytes32('')
    }

    const tx = await deployed.policy.purchaseCover(args)
    const { events } = await tx.wait()
    const event = events.find(x => x.event === 'CoverPurchased')

    const cxToken = await cxTokenUtil.atAddress(event.args.cxToken, deployed)

    const cxTokenBalance = await cxToken.balanceOf(owner.address)
    cxTokenBalance.should.equal(helper.ether(500_000))

    const commitment = await deployed.policy.getCommitment(coverKey, helper.emptyBytes32)
    commitment.should.equal(helper.ether(500_000, PRECISION))

    const available = await deployed.policy.getAvailableLiquidity(coverKey)
    available.should.be.gt(amount)

    event.args.policyId.should.equal(1)
  })

  it('must correctly return new policy id', async () => {
    const [owner] = await ethers.getSigners()

    const amount = helper.ether(500_000, PRECISION)
    await deployed.dai.approve(deployed.policy.address, amount)

    const args = {
      onBehalfOf: owner.address,
      coverKey,
      productKey: helper.emptyBytes32,
      coverDuration: '1',
      amountToCover: amount,
      referralCode: key.toBytes32('')
    }

    const tx = await deployed.policy.purchaseCover(args)
    const { events } = await tx.wait()
    const event = events.find(x => x.event === 'CoverPurchased')

    event.args.policyId.should.equal(2)
  })

  it('reverts when policy is disabled', async () => {
    const [owner] = await ethers.getSigners()

    const amount = helper.ether(500_000, PRECISION)
    await deployed.dai.approve(deployed.policy.address, amount)

    await deployed.cover.disablePolicy(coverKey, helper.emptyBytes32, true, 'reason: testing')

    const args = {
      onBehalfOf: owner.address,
      coverKey,
      productKey: helper.emptyBytes32,
      coverDuration: '1',
      amountToCover: amount,
      referralCode: key.toBytes32('')
    }

    await deployed.policy.purchaseCover(args)
      .should.be.rejectedWith('Policy purchase disabled')

    await deployed.cover.disablePolicy(coverKey, helper.emptyBytes32, false, 'reason: testing')

    // Can purchase after re-enabled
    await deployed.policy.purchaseCover(args)
      .should.not.be.rejected
  })

  it('must revert if zero is sent as the amount to cover', async () => {
    const [owner] = await ethers.getSigners()

    await deployed.dai.approve(deployed.policy.address, ethers.constants.MaxUint256)

    const args = {
      onBehalfOf: owner.address,
      coverKey,
      productKey: helper.emptyBytes32,
      coverDuration: '1',
      amountToCover: '0',
      referralCode: key.toBytes32('')
    }

    await deployed.policy.purchaseCover(args)
      .should.be.rejectedWith('Enter an amount')
  })

  it('must revert if invalid value is sent as the cover duration', async () => {
    const [owner] = await ethers.getSigners()

    await deployed.dai.approve(deployed.policy.address, ethers.constants.MaxUint256)

    const args = {
      onBehalfOf: owner.address,
      coverKey,
      productKey: helper.emptyBytes32,
      coverDuration: '0',
      amountToCover: helper.ether(500_000, PRECISION),
      referralCode: key.toBytes32('')
    }

    await deployed.policy.purchaseCover(args)
      .should.be.rejectedWith('Invalid cover duration')

    args.coverDuration = '5'

    await deployed.policy.purchaseCover(args)
      .should.be.rejectedWith('Invalid cover duration')
  })

  it('must revert if the protocol is paused', async () => {
    const [owner] = await ethers.getSigners()

    await deployed.protocol.pause()

    await deployed.dai.approve(deployed.policy.address, ethers.constants.MaxUint256)

    const args = {
      onBehalfOf: owner.address,
      coverKey,
      productKey: helper.emptyBytes32,
      coverDuration: '1',
      amountToCover: helper.ether(500_000, PRECISION),
      referralCode: key.toBytes32('')
    }

    await deployed.policy.purchaseCover(args)
      .should.be.rejectedWith('Protocol is paused')

    await deployed.protocol.unpause()
  })

  it('must revert if cover is not normal', async () => {
    const [owner] = await ethers.getSigners()

    const info = key.toBytes32('info')
    await deployed.npm.approve(deployed.governance.address, helper.ether(1000))
    await deployed.governance.report(coverKey, helper.emptyBytes32, info, helper.ether(1000))

    await deployed.dai.approve(deployed.policy.address, ethers.constants.MaxUint256)

    const args = {
      onBehalfOf: owner.address,
      coverKey,
      productKey: helper.emptyBytes32,
      coverDuration: '1',
      amountToCover: helper.ether(500_000, PRECISION),
      referralCode: key.toBytes32('')
    }

    await deployed.policy.purchaseCover(args)
      .should.be.rejectedWith('Status not normal')
  })
})

describe('Policy: purchaseCover (requires whitelist)', () => {
  let deployed, coverKey

  before(async () => {
    const [owner] = await ethers.getSigners()
    deployed = await deployDependencies()

    deployed.policy = await deployer.deployWithLibraries(cache, 'Policy', {
      AccessControlLibV1: deployed.accessControlLibV1.address,
      BaseLibV1: deployed.baseLibV1.address,
      CoverUtilV1: deployed.coverUtilV1.address,
      PolicyHelperV1: deployed.policyHelperV1.address,
      ProtoUtilV1: deployed.protoUtilV1.address,
      StrategyLibV1: deployed.strategyLibV1.address,
      ValidationLibV1: deployed.validationLibV1.address
    }, deployed.store.address)

    await deployed.protocol.addContract(key.PROTOCOL.CNS.COVER_POLICY, deployed.policy.address)

    coverKey = key.toBytes32('foo-bar')
    const stakeWithFee = helper.ether(10_000)
    const initialReassuranceAmount = helper.ether(1_000_000, PRECISION)
    const initialLiquidity = helper.ether(4_000_000, PRECISION)
    const minStakeToReport = helper.ether(250)
    const reportingPeriod = 7 * DAYS
    const cooldownPeriod = 1 * DAYS
    const claimPeriod = 7 * DAYS
    const floor = helper.percentage(7)
    const ceiling = helper.percentage(45)
    const reassuranceRate = helper.percentage(50)
    const leverageFactor = '1'

    const requiresWhitelist = true

    const info = key.toBytes32('info')

    deployed.cover.updateCoverCreatorWhitelist(owner.address, true)

    await deployed.npm.approve(deployed.stakingContract.address, stakeWithFee)
    await deployed.dai.approve(deployed.cover.address, initialReassuranceAmount)

    await deployed.cover.addCover({
      coverKey,
      info,
      tokenName: 'POD',
      tokenSymbol: 'POD',
      supportsProducts: false,
      requiresWhitelist,
      stakeWithFee,
      initialReassuranceAmount,
      minStakeToReport,
      reportingPeriod,
      cooldownPeriod,
      claimPeriod,
      floor,
      ceiling,
      reassuranceRate,
      leverageFactor
    })

    deployed.vault = await composer.vault.getVault({
      store: deployed.store,
      libs: {
        accessControlLibV1: deployed.accessControlLibV1,
        baseLibV1: deployed.baseLibV1,
        transferLib: deployed.transferLib,
        protoUtilV1: deployed.protoUtilV1,
        registryLibV1: deployed.registryLibV1,
        validationLibV1: deployed.validationLibV1
      }
    }, coverKey)

    await deployed.dai.approve(deployed.vault.address, initialLiquidity)
    await deployed.npm.approve(deployed.vault.address, minStakeToReport)
    await deployed.vault.addLiquidity(coverKey, initialLiquidity, minStakeToReport, key.toBytes32(''))
  })

  it('must succeed without any errors', async () => {
    const [owner] = await ethers.getSigners()
    const amount = helper.ether(500_000, PRECISION)

    await deployed.cover.updateCoverUsersWhitelist(coverKey, helper.emptyBytes32, [owner.address], [true])

    await deployed.dai.approve(deployed.policy.address, amount)

    const args = {
      onBehalfOf: owner.address,
      coverKey,
      productKey: helper.emptyBytes32,
      coverDuration: '1',
      amountToCover: amount,
      referralCode: key.toBytes32('')
    }

    await deployed.policy.purchaseCover(args)

    const commitment = await deployed.policy.getCommitment(coverKey, helper.emptyBytes32)
    commitment.should.equal(amount)

    const available = await deployed.policy.getAvailableLiquidity(coverKey)
    available.should.be.gt(amount)
  })

  it('when accessed by a user who is not whitelisted', async () => {
    const [, bob] = await ethers.getSigners()
    const amount = helper.ether(500_000, PRECISION)

    await deployed.npm.transfer(bob.address, amount)

    await deployed.dai.connect(bob).approve(deployed.policy.address, amount)

    const args = {
      onBehalfOf: bob.address,
      coverKey,
      productKey: helper.emptyBytes32,
      coverDuration: '1',
      amountToCover: amount,
      referralCode: key.toBytes32('')
    }

    await deployed.policy.connect(bob).purchaseCover(args)
      .should.be.rejectedWith('You are not whitelisted')
  })
})
