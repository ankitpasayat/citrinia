export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      bookmarks: {
        Row: {
          created_at: string
          peel_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          peel_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          peel_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookmarks_peel_id_fkey"
            columns: ["peel_id"]
            isOneToOne: false
            referencedRelation: "peels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookmarks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      follows: {
        Row: {
          created_at: string
          followee_id: string
          follower_id: string
        }
        Insert: {
          created_at?: string
          followee_id: string
          follower_id: string
        }
        Update: {
          created_at?: string
          followee_id?: string
          follower_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follows_followee_id_fkey"
            columns: ["followee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      likes: {
        Row: {
          created_at: string
          id: number
          peel_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: number
          peel_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: number
          peel_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "likes_peel_id_fkey"
            columns: ["peel_id"]
            isOneToOne: false
            referencedRelation: "peels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      mutes: {
        Row: {
          created_at: string
          muted_id: string
          muter_id: string
        }
        Insert: {
          created_at?: string
          muted_id: string
          muter_id: string
        }
        Update: {
          created_at?: string
          muted_id?: string
          muter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mutes_muter_id_fkey"
            columns: ["muter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mutes_muted_id_fkey"
            columns: ["muted_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      notifications: {
        Row: {
          actor_id: string
          created_at: string
          id: number
          peel_id: string | null
          read_at: string | null
          type: string
          user_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          id?: number
          peel_id?: string | null
          read_at?: string | null
          type: string
          user_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: number
          peel_id?: string | null
          read_at?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_peel_id_fkey"
            columns: ["peel_id"]
            isOneToOne: false
            referencedRelation: "peels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      peel_media: {
        Row: {
          alt: string
          height: number | null
          id: number
          kind: string
          peel_id: string
          position: number
          url: string
          width: number | null
        }
        Insert: {
          alt?: string
          height?: number | null
          id?: number
          kind: string
          peel_id: string
          position?: number
          url: string
          width?: number | null
        }
        Update: {
          alt?: string
          height?: number | null
          id?: number
          kind?: string
          peel_id?: string
          position?: number
          url?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "peel_media_peel_id_fkey"
            columns: ["peel_id"]
            isOneToOne: false
            referencedRelation: "peels"
            referencedColumns: ["id"]
          }
        ]
      }
      peels: {
        Row: {
          created_at: string
          id: string
          parent_id: string | null
          quote_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          parent_id?: string | null
          quote_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          parent_id?: string | null
          quote_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "peels_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "peels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "peels_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "peels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "peels_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      username_history: {
        Row: {
          profile_id: string
          released_at: string
          username: string
        }
        Insert: {
          profile_id: string
          released_at?: string
          username: string
        }
        Update: {
          profile_id?: string
          released_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "username_history_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      reports: {
        Row: {
          created_at: string
          id: string
          note: string
          peel_id: string | null
          profile_id: string | null
          reason: string
          reporter_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string
          peel_id?: string | null
          profile_id?: string | null
          reason: string
          reporter_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string
          peel_id?: string | null
          profile_id?: string | null
          reason?: string
          reporter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_peel_id_fkey"
            columns: ["peel_id"]
            isOneToOne: false
            referencedRelation: "peels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      profiles: {
        Row: {
          avatar_url: string
          banner_url: string
          bio: string
          created_at: string
          id: string
          location: string
          name: string
          pinned_peel_id: string | null
          username: string
          website: string
        }
        Insert: {
          avatar_url: string
          banner_url?: string
          bio?: string
          created_at?: string
          id: string
          location?: string
          name: string
          pinned_peel_id?: string | null
          username: string
          website?: string
        }
        Update: {
          avatar_url?: string
          banner_url?: string
          bio?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          pinned_peel_id?: string | null
          username?: string
          website?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_pinned_peel_id_fkey"
            columns: ["pinned_peel_id"]
            isOneToOne: false
            referencedRelation: "peels"
            referencedColumns: ["id"]
          }
        ]
      }
      reposts: {
        Row: {
          created_at: string
          peel_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          peel_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          peel_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reposts_peel_id_fkey"
            columns: ["peel_id"]
            isOneToOne: false
            referencedRelation: "peels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reposts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      change_username: {
        Args: {
          new_username: string
        }
        Returns: string
      }
      delete_account: {
        Args: {
          confirm: string
        }
        Returns: undefined
      }
      blocked_ids: {
        Args: Record<string, never>
        Returns: string[]
      }
      blocked_peel: {
        Args: {
          peel: string
        }
        Returns: boolean
      }
      blocks_between: {
        Args: {
          a: string
          b: string
        }
        Returns: boolean
      }
      hidden_from: {
        Args: {
          viewer: string
          author: string
        }
        Returns: boolean
      }
      home_timeline: {
        Args: {
          following_only?: boolean
          before?: string | null
          page_size?: number
          before_id?: string | null
          before_by?: string | null
        }
        Returns: {
          peel_id: string
          repost_by: string | null
          sort_at: string
        }[]
      }
      peel_ancestors: {
        Args: {
          of_peel: string
          max_depth?: number
        }
        Returns: {
          id: string
          depth: number
        }[]
      }
      seed_triggers: {
        Args: {
          enabled: boolean
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (Database["public"]["Tables"] & Database["public"]["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (Database["public"]["Tables"] &
      Database["public"]["Views"])
  ? (Database["public"]["Tables"] &
      Database["public"]["Views"])[PublicTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof Database["public"]["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof Database["public"]["Tables"]
  ? Database["public"]["Tables"][PublicTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof Database["public"]["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof Database["public"]["Tables"]
  ? Database["public"]["Tables"][PublicTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof Database["public"]["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof Database["public"]["Enums"]
  ? Database["public"]["Enums"][PublicEnumNameOrOptions]
  : never
