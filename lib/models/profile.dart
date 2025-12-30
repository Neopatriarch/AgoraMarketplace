// lib/models/profile.dart
// Agora App - Profile Model
// Version 1.0
// Targeting Flutter 3.38.1 / Dart 3.10.3

/// A data model class representing a user's profile.
///
/// This class holds the parsed metadata from a user's Nostr kind:0 event.
class Profile {
  /// The user's public key (npub), serving as the unique identifier.
  final String npub;

  /// The user's chosen display name. Can be null if not set.
  final String? name;

  /// The user's biography or "about" section. Can be null if not set.
  final String? about;

  /// A URL to the user's profile picture. Can be null if not set.
  final String? pictureUrl;

  /// The user's human-readable NIP-05 identifier. Can be null if not verified.
  final String? nip05;

  Profile({
    required this.npub,
    this.name,
    this.about,
    this.pictureUrl,
    this.nip05,
  });

  /// Creates a [Profile] instance from a JSON map.
  ///
  /// The [npub] is passed separately as it's the event's public key,
  /// not contained within the event's content JSON.
  factory Profile.fromJson(Map<String, dynamic> json, String npub) {
    return Profile(
      npub: npub,
      name: json['name'],
      about: json['about'],
      pictureUrl: json['picture'],
      nip05: json['nip05'],
    );
  }

  /// Serializes the [Profile] object into a JSON map.
  ///
  /// This is primarily used for caching the profile data locally.
  Map<String, dynamic> toJson() {
    return {
      'npub': npub,
      'name': name,
      'about': about,
      'pictureUrl': pictureUrl,
      'nip05': nip05,
    };
  }
}

// End of lib/models/profile.dart
