# AI Action Hub device adapter kits

These files are small reference clients for connecting native apps to OEAP **AI Action Hub**. They intentionally keep business logic on the Action Hub side: the device app authenticates, submits a Universal Action payload, and receives either an execution result or an `approval_required` response.

## Apple

Copy `apple/OEAPActionHubClient.swift` into the iOS/macOS app target, then configure it after login:

```swift
OEAPActionHubClient.shared.configure(
    .init(
        baseURL: URL(string: "https://your-oeap.example")!,
        bearerToken: sessionToken
    )
)
```

A generated App Intent can call:

```swift
let response = try await OEAPActionHubClient.shared.execute(
    actionID: "crm.customer.search",
    payloadJSON: payloadJSON
)
```

The web console can generate the App Intent skeleton for each Universal Action. Apple signing, App Intents metadata, entitlement approval, App Store/TestFlight publishing and any Model Delegation entitlement remain Apple-controlled steps.

## Android

Copy `android/OeapActionHubClient.kt` into the Android app module and configure it after login:

```kotlin
OeapActionHubClient.configure(
    OeapActionHubClient.Configuration(
        baseUrl = "https://your-oeap.example",
        bearerToken = sessionToken
    )
)
```

Call network execution from a background coroutine/thread:

```kotlin
val response = OeapActionHubClient.execute(
    actionId = "crm.customer.search",
    payloadJson = payloadJson
)
```

The web console can generate an `@AppFunction` wrapper for each Universal Action. The Android SDK/app must still be built against the AppFunctions version selected by the app, signed with the developer's key, and distributed through the appropriate OEM/store channel.

## Huawei / Xiaomi / HONOR

The Action Hub web console generates a remote-action contract containing:

- stable Action ID;
- display name and natural-language description;
- JSON input/output schemas;
- Action Hub HTTPS endpoint;
- risk and approval metadata.

Map that contract into the respective Celia/小艺, Xiaomi Agent or YOYO developer console/SDK. The vendor developer account, application identity, review and publishing remain external authorization steps.

## Security rules

- Never embed a long-lived enterprise admin token in an app binary.
- Use the existing OEAP identity flow or an enterprise gateway to obtain a scoped session/token.
- Use HTTPS in production.
- Keep `permissionAction` narrow and grant it only to the intended organization roles.
- R2 and R3 actions are intentionally asynchronous from the assistant's perspective: the first request creates an enterprise approval and does **not** invoke the downstream Connector.
- R3 approval requires the approver to type the exact Universal Action ID; downstream payment/banking controls still remain mandatory.
