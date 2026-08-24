package com.clicpos.nativeprinter

import android.util.Base64
import com.machinezoo.sourceafis.FingerprintImage
import com.machinezoo.sourceafis.FingerprintImageOptions
import com.machinezoo.sourceafis.FingerprintMatcher
import com.machinezoo.sourceafis.FingerprintTemplate

internal data class FingerprintCandidate(val credentialId: String, val encodedTemplate: String)
internal data class FingerprintMatch(val credentialId: String?, val score: Double, val threshold: Double)

/** Extracts and compares minutiae. Raw fingerprint images are never persisted. */
internal object ClicPOSFingerprintEngine {
    const val TEMPLATE_PREFIX = "sourceafis:3.18.1:"
    const val MATCH_THRESHOLD = 40.0

    fun createTemplate(capture: Uru4500Capture): String {
        val image = FingerprintImage(
            capture.width,
            capture.height,
            capture.grayscale,
            FingerprintImageOptions().dpi(500.0),
        )
        val serialized = FingerprintTemplate(image).toByteArray()
        return TEMPLATE_PREFIX + Base64.encodeToString(serialized, Base64.NO_WRAP)
    }

    fun identify(capture: Uru4500Capture, candidates: List<FingerprintCandidate>): FingerprintMatch {
        val probe = FingerprintTemplate(
            FingerprintImage(
                capture.width,
                capture.height,
                capture.grayscale,
                FingerprintImageOptions().dpi(500.0),
            ),
        )
        val matcher = FingerprintMatcher(probe)
        var bestId: String? = null
        var bestScore = Double.NEGATIVE_INFINITY

        for (candidate in candidates) {
            val encoded = candidate.encodedTemplate.removePrefix(TEMPLATE_PREFIX)
            if (encoded == candidate.encodedTemplate) continue
            val template = runCatching {
                FingerprintTemplate(Base64.decode(encoded, Base64.DEFAULT))
            }.getOrNull() ?: continue
            val score = matcher.match(template)
            if (score > bestScore) {
                bestScore = score
                bestId = candidate.credentialId
            }
        }

        val normalizedScore = if (bestScore.isFinite()) bestScore else 0.0
        return FingerprintMatch(
            credentialId = bestId?.takeIf { normalizedScore >= MATCH_THRESHOLD },
            score = normalizedScore,
            threshold = MATCH_THRESHOLD,
        )
    }
}
