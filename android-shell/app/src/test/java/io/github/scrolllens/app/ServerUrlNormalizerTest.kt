package io.github.scrolllens.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerUrlNormalizerTest {

    @Test
    fun normalizeAddsDefaultHttpSchemeAndStripsTrailingSlash() {
        assertEquals("http://192.168.1.20:8000", ServerUrlNormalizer.normalize("192.168.1.20:8000/"))
        assertEquals("https://novel.example.com", ServerUrlNormalizer.normalize("  https://novel.example.com///  "))
    }

    @Test
    fun isValidHttpUrlRejectsUnsafeOrBlankInputs() {
        assertTrue(ServerUrlNormalizer.isValidHttpUrl("192.168.1.10:8000"))
        assertTrue(ServerUrlNormalizer.isValidHttpUrl("https://scrolllens.example.com"))
        assertFalse(ServerUrlNormalizer.isValidHttpUrl(""))
        assertFalse(ServerUrlNormalizer.isValidHttpUrl("javascript:alert(1)"))
        assertFalse(ServerUrlNormalizer.isValidHttpUrl("file:///etc/passwd"))
    }

    @Test
    fun healthUrlAppendsApiPath() {
        assertEquals(
            "http://127.0.0.1:8000/api/v1/health",
            ServerUrlNormalizer.healthUrl("127.0.0.1:8000/")
        )
    }
}
