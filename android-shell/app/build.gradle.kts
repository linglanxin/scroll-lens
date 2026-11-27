import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val localProps = Properties().apply {
    val lpFile = rootProject.file("local.properties")
    if (lpFile.exists()) {
        lpFile.inputStream().use { load(it) }
    }
}

fun resolveConfig(propKey: String, envKey: String, defaultVal: String = ""): String {
    val fromGradle = (project.findProperty(propKey) as String?)?.trim()
    if (!fromGradle.isNullOrBlank()) return fromGradle
    val fromLocal = localProps.getProperty(propKey)?.trim()
    if (!fromLocal.isNullOrBlank()) return fromLocal
    val fromEnv = System.getenv(envKey)?.trim()
    if (!fromEnv.isNullOrBlank()) return fromEnv
    return defaultVal
}

fun escapeBuildConfigString(value: String): String {
    return value.replace("\\", "\\\\").replace("\"", "\\\"")
}

val ciVersionCode = (project.findProperty("versionCode") as String?)?.toIntOrNull() ?: 1
val ciVersionName = (project.findProperty("versionName") as String?)?.takeIf { it.isNotBlank() } ?: "1.0.0"
val defaultServerUrl = resolveConfig("defaultServerUrl", "SCROLLLENS_DEFAULT_SERVER_URL")
val defaultServerName = resolveConfig("defaultServerName", "SCROLLLENS_DEFAULT_SERVER_NAME", "默认服务器")

android {
    namespace = "io.github.scrolllens.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.scrolllens.app"
        minSdk = 24
        targetSdk = 35
        versionCode = ciVersionCode
        versionName = ciVersionName
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"${escapeBuildConfigString(defaultServerUrl)}\"")
        buildConfigField("String", "DEFAULT_SERVER_NAME", "\"${escapeBuildConfigString(defaultServerName)}\"")
    }

    signingConfigs {
        val ksPath = System.getenv("ANDROID_KEYSTORE_PATH")
        if (!ksPath.isNullOrBlank() && file(ksPath).exists()) {
            create("release") {
                storeFile = file(ksPath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: ""
                keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: ""
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: ""
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            val releaseSigning = signingConfigs.findByName("release")
            if (releaseSigning != null) {
                signingConfig = releaseSigning
            }
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("androidx.recyclerview:recyclerview:1.3.2")

    testImplementation("junit:junit:4.13.2")
}
