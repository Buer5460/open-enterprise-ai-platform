import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/**
 * Dependency-free Android client for OEAP AI Action Hub.
 *
 * Configure after the app has obtained an OEAP/enterprise session token.
 * Call from a background coroutine/thread because network I/O is blocking.
 */
object OeapActionHubClient {
    data class Configuration(
        val baseUrl: String,
        val bearerToken: String,
        val organizationId: String? = null,
        val memberId: String? = null,
        val connectTimeoutMs: Int = 15_000,
        val readTimeoutMs: Int = 120_000
    )

    @Volatile
    private var configuration: Configuration? = null

    fun configure(configuration: Configuration) {
        this.configuration = configuration.copy(
            baseUrl = configuration.baseUrl.trimEnd('/')
        )
    }

    /**
     * Execute a Universal Action and return the raw Action Hub JSON response.
     * R2/R3 actions normally return an `approval_required` body with HTTP 202.
     */
    fun execute(
        actionId: String,
        payloadJson: String,
        preferredProvider: String? = null
    ): String {
        val config = configuration
            ?: error("OeapActionHubClient is not configured")

        val input = try {
            JSONObject(payloadJson)
        } catch (error: Exception) {
            throw IllegalArgumentException(
                "Action payload must be a JSON object",
                error
            )
        }

        val encodedAction = URLEncoder.encode(
            actionId,
            StandardCharsets.UTF_8.name()
        ).replace("+", "%20")
        val endpoint = URL(
            "${config.baseUrl}/api/action-hub/actions/$encodedAction/execute"
        )
        val body = JSONObject().put("input", input)
        if (!preferredProvider.isNullOrBlank()) {
            body.put("preferredProvider", preferredProvider)
        }

        val connection = endpoint.openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = config.connectTimeoutMs
            connection.readTimeout = config.readTimeoutMs
            connection.doOutput = true
            connection.setRequestProperty(
                "Content-Type",
                "application/json"
            )
            connection.setRequestProperty(
                "Authorization",
                "Bearer ${config.bearerToken}"
            )
            config.organizationId?.let {
                connection.setRequestProperty("X-OEAP-Org", it)
            }
            config.memberId?.let {
                connection.setRequestProperty("X-OEAP-Member", it)
            }

            connection.outputStream.use { output ->
                output.write(
                    body.toString().toByteArray(StandardCharsets.UTF_8)
                )
            }

            val status = connection.responseCode
            val stream = if (status in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream
            }
            val response = stream?.bufferedReader(
                StandardCharsets.UTF_8
            )?.use { it.readText() }.orEmpty()

            if (status !in 200..299) {
                throw IllegalStateException(
                    "Action Hub HTTP $status: $response"
                )
            }

            return response
        } finally {
            connection.disconnect()
        }
    }
}
