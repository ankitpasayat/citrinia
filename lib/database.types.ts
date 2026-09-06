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
      profiles: {
        Row: {
          avatar_url: string
          bio: string
          id: string
          name: string
          username: string
        }
        Insert: {
          avatar_url: string
          bio?: string
          id: string
          name: string
          username: string
        }
        Update: {
          avatar_url?: string
          bio?: string
          id?: string
          name?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "users"
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
