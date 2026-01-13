# Subscription Lifecycle

This document outlines the lifecycle of a subscription within the Ahmed-nol-DeX system.

## Overview

The subscription lifecycle consists of several key stages that a subscription goes through from creation to cancellation or expiration.

## Subscription States

### 1. Pending
- Initial state when a subscription is created
- Awaiting activation or confirmation
- User may not have access to features yet

### 2. Active
- Subscription is currently valid and active
- User has full access to subscribed features
- Recurring billing is in effect

### 3. Paused
- Subscription is temporarily suspended
- User access is revoked
- Billing is halted during this period
- Can be resumed by the user or administrator

### 4. Expired
- Subscription has reached its end date
- User access is revoked
- No further billing occurs

### 5. Cancelled
- Subscription has been explicitly cancelled
- User access is immediately revoked
- Refund policies may apply based on circumstances

## Transition Rules

### Active to Paused
- User can pause their subscription at any time
- System automatically pauses if payment fails

### Paused to Active
- User can resume within a specified grace period
- Administrator can force resumption

### Active to Expired
- Automatic transition when end date is reached
- Notifications sent before expiration

### Any State to Cancelled
- User-initiated or administrator-initiated
- Final state, no reversal possible

## Billing Events

- **Subscription Created**: Initial billing event
- **Subscription Renewed**: Recurring billing event
- **Subscription Paused**: Billing halted
- **Subscription Resumed**: Billing resumes
- **Subscription Cancelled**: Final billing adjustment

## Notifications

Notifications are sent at key lifecycle events:
- Subscription activated
- Subscription expiring soon (7, 3, 1 days before)
- Subscription expired
- Subscription cancelled
- Payment failures

---

**Authored by DR Ahmed Mohamed**

**Last Updated: 2026-01-13**
