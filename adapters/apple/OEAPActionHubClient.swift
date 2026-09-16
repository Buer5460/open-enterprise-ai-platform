import Foundation

/// Small dependency-free client for calling OEAP AI Action Hub from an Apple app.
/// Configure it once after your app has obtained an OEAP/enterprise session token.
public final class OEAPActionHubClient: @unchecked Sendable {
    public static let shared = OEAPActionHubClient()

    public struct Configuration: Sendable {
        public let baseURL: URL
        public let bearerToken: String
        public let organizationID: String?
        public let memberID: String?

        public init(
            baseURL: URL,
            bearerToken: String,
            organizationID: String? = nil,
            memberID: String? = nil
        ) {
            self.baseURL = baseURL
            self.bearerToken = bearerToken
            self.organizationID = organizationID
            self.memberID = memberID
        }
    }

    public enum ClientError: LocalizedError {
        case notConfigured
        case invalidPayload
        case invalidResponse
        case http(status: Int, body: String)

        public var errorDescription: String? {
            switch self {
            case .notConfigured:
                return "OEAPActionHubClient is not configured"
            case .invalidPayload:
                return "Action payload is not valid JSON"
            case .invalidResponse:
                return "Action Hub returned an invalid response"
            case let .http(status, body):
                return "Action Hub HTTP \(status): \(body)"
            }
        }
    }

    private let lock = NSLock()
    private var configuration: Configuration?
    private var session: URLSession = .shared

    private init() {}

    public func configure(
        _ configuration: Configuration,
        session: URLSession = .shared
    ) {
        lock.lock()
        defer { lock.unlock() }
        self.configuration = configuration
        self.session = session
    }

    /// Executes a Universal Action and returns the raw Action Hub JSON response.
    /// R2/R3 actions normally return an `approval_required` response (HTTP 202).
    public func execute(
        actionID: String,
        payloadJSON: String,
        preferredProvider: String? = nil
    ) async throws -> String {
        let state = try configuredState()
        guard let payloadData = payloadJSON.data(using: .utf8),
              let payload = try? JSONSerialization.jsonObject(with: payloadData) else {
            throw ClientError.invalidPayload
        }

        let encodedID = actionID.addingPercentEncoding(
            withAllowedCharacters: .urlPathAllowed
        ) ?? actionID
        let endpoint = state.configuration.baseURL
            .appendingPathComponent("api")
            .appendingPathComponent("action-hub")
            .appendingPathComponent("actions")
            .appendingPathComponent(encodedID)
            .appendingPathComponent("execute")

        var body: [String: Any] = ["input": payload]
        if let preferredProvider, !preferredProvider.isEmpty {
            body["preferredProvider"] = preferredProvider
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(
            "Bearer \(state.configuration.bearerToken)",
            forHTTPHeaderField: "Authorization"
        )
        if let organizationID = state.configuration.organizationID {
            request.setValue(organizationID, forHTTPHeaderField: "X-OEAP-Org")
        }
        if let memberID = state.configuration.memberID {
            request.setValue(memberID, forHTTPHeaderField: "X-OEAP-Member")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await state.session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ClientError.invalidResponse
        }

        let text = String(data: data, encoding: .utf8) ?? ""
        guard (200..<300).contains(http.statusCode) else {
            throw ClientError.http(status: http.statusCode, body: text)
        }
        return text
    }

    private func configuredState() throws -> (
        configuration: Configuration,
        session: URLSession
    ) {
        lock.lock()
        defer { lock.unlock() }
        guard let configuration else {
            throw ClientError.notConfigured
        }
        return (configuration, session)
    }
}
